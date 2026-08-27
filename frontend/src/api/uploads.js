import { apiFetch } from './client.js';

const CONCURRENT_PARTS = 3;

function uploadPart({ url, blob, partNumber, loadedByPart, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    request.open('PUT', url);
    request.upload.addEventListener('progress', (event) => {
      loadedByPart.set(partNumber, event.loaded);
      const loaded = [...loadedByPart.values()].reduce((total, value) => total + value, 0);
      onProgress(loaded);
    });
    request.addEventListener('load', () => {
      signal?.removeEventListener('abort', abort);
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Storage rejected part ${partNumber}.`));
        return;
      }
      const etag = request.getResponseHeader('etag');
      if (!etag) {
        reject(new Error('The storage response did not expose an ETag header.'));
        return;
      }
      loadedByPart.set(partNumber, blob.size);
      resolve({ partNumber, etag });
    });
    request.addEventListener('error', () => reject(new Error(`Network error while uploading part ${partNumber}.`)));
    request.addEventListener('abort', () => reject(new DOMException('Upload cancelled.', 'AbortError')));
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

export async function uploadFile(file, { onProgress, signal }) {
  let createdFileId = null;
  let completionStarted = false;
  try {
    const start = await apiFetch('/api/files/uploads', {
      method: 'POST',
      body: JSON.stringify({
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
      signal,
    });
    createdFileId = start.file.id;
    const partNumbers = Array.from({ length: start.partCount }, (_, index) => index + 1);
    const loadedByPart = new Map();
    const partController = new AbortController();
    const abortParts = () => partController.abort();
    signal?.addEventListener('abort', abortParts, { once: true });
    const tasks = partNumbers.map((partNumber) => async () => {
      const signed = await apiFetch(`/api/files/${createdFileId}/parts`, {
        method: 'POST',
        body: JSON.stringify({ partNumbers: [partNumber] }),
        signal: partController.signal,
      });
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
    const completed = await apiFetch(`/api/files/${createdFileId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ parts }),
      signal,
    });
    onProgress(file.size);
    return completed.file;
  } catch (error) {
    if (createdFileId && !completionStarted) {
      await apiFetch(`/api/files/${createdFileId}`, { method: 'DELETE' }).catch(() => {});
    }
    throw error;
  }
}
