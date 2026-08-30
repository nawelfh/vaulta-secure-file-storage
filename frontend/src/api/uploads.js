import { apiFetch } from './client.js';

const CONCURRENT_PARTS = 3;

export const UPLOAD_ERROR_KINDS = Object.freeze({
  API_INITIATION: 'api-initiation',
  PART_AUTHORIZATION: 'part-authorization',
  STORAGE_NETWORK: 'storage-network',
  STORAGE_REJECTED: 'storage-rejected',
  MISSING_ETAG: 'missing-etag',
  FINALIZATION: 'finalization',
});

export class UploadError extends Error {
  constructor(kind, { requestId, code, cause } = {}) {
    super(kind, { cause });
    this.name = 'UploadError';
    this.kind = kind;
    this.requestId = requestId;
    this.code = code;
  }
}

function apiUploadError(kind, error) {
  if (error?.name === 'AbortError') return error;
  return new UploadError(kind, {
    requestId: error?.requestId,
    code: error?.code,
    cause: error,
  });
}

function uploadPart({ url, blob, partNumber, loadedByPart, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    let settled = false;

    function settle(action, value) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      action(value);
    }

    signal?.addEventListener('abort', abort, { once: true });
    request.open('PUT', url);
    request.upload.addEventListener('progress', (event) => {
      loadedByPart.set(partNumber, event.loaded);
      const loaded = [...loadedByPart.values()].reduce((total, value) => total + value, 0);
      onProgress?.(loaded);
    });
    request.addEventListener('load', () => {
      if (request.status < 200 || request.status >= 300) {
        settle(reject, new UploadError(UPLOAD_ERROR_KINDS.STORAGE_REJECTED));
        return;
      }
      const etag = request.getResponseHeader('etag');
      if (!etag) {
        settle(reject, new UploadError(UPLOAD_ERROR_KINDS.MISSING_ETAG));
        return;
      }
      loadedByPart.set(partNumber, blob.size);
      settle(resolve, { partNumber, etag });
    });
    request.addEventListener('error', () => {
      settle(reject, new UploadError(UPLOAD_ERROR_KINDS.STORAGE_NETWORK));
    });
    request.addEventListener('abort', () => {
      settle(reject, new DOMException('Upload cancelled.', 'AbortError'));
    });
    request.send(blob);
  });
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function uploadFile(file, { onProgress, onPhase, signal }) {
  let createdFileId = null;
  let completionStarted = false;
  try {
    onPhase?.('preparing');
    let start;
    try {
      start = await apiFetch('/api/files/uploads', {
        method: 'POST',
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
        signal,
      });
    } catch (error) {
      throw apiUploadError(UPLOAD_ERROR_KINDS.API_INITIATION, error);
    }
    createdFileId = start.file.id;
    onPhase?.('uploading');
    const partNumbers = Array.from({ length: start.partCount }, (_, index) => index + 1);
    const loadedByPart = new Map();
    const partController = new AbortController();
    const abortParts = () => partController.abort();
    signal?.addEventListener('abort', abortParts, { once: true });
    const tasks = partNumbers.map((partNumber) => async () => {
      let signed;
      try {
        signed = await apiFetch(`/api/files/${createdFileId}/parts`, {
          method: 'POST',
          body: JSON.stringify({ partNumbers: [partNumber] }),
          signal: partController.signal,
        });
      } catch (error) {
        throw apiUploadError(UPLOAD_ERROR_KINDS.PART_AUTHORIZATION, error);
      }
      const startByte = (partNumber - 1) * start.partSizeBytes;
      const blob = file.slice(startByte, Math.min(startByte + start.partSizeBytes, file.size));
      return uploadPart({
        url: signed.parts[0].url,
        blob,
        partNumber,
        loadedByPart,
        onProgress,
        signal: partController.signal,
      });
    });
    let parts;
    try {
      parts = await runPool(tasks, CONCURRENT_PARTS);
    } catch (error) {
      partController.abort();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortParts);
    }

    completionStarted = true;
    onPhase?.('verifying');
    onProgress?.(file.size);
    let completed;
    try {
      completed = await apiFetch(`/api/files/${createdFileId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ parts }),
        signal,
      });
    } catch (error) {
      throw apiUploadError(UPLOAD_ERROR_KINDS.FINALIZATION, error);
    }
    return completed.file;
  } catch (error) {
    if (createdFileId && !completionStarted) {
      await apiFetch(`/api/files/${createdFileId}`, { method: 'DELETE' }).catch(() => {});
    }
    throw error;
  }
}
