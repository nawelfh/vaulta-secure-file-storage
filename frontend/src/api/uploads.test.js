/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch } from './client.js';
import { UPLOAD_ERROR_KINDS, uploadFile } from './uploads.js';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

class FakeXMLHttpRequest {
  static behavior = 'success';

  constructor() {
    this.listeners = {};
    this.uploadListeners = {};
    this.status = 0;
    this.upload = {
      addEventListener: (name, listener) => { this.uploadListeners[name] = listener; },
    };
  }

  open() {}

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  getResponseHeader(name) {
    if (name === 'etag' && FakeXMLHttpRequest.behavior !== 'missing-etag') return 'etag-1';
    return null;
  }

  send(blob) {
    queueMicrotask(() => {
      if (FakeXMLHttpRequest.behavior === 'pending') return;
      if (FakeXMLHttpRequest.behavior === 'network') {
        this.listeners.error();
        return;
      }
      this.uploadListeners.progress?.({ loaded: blob.size });
      this.status = FakeXMLHttpRequest.behavior === 'rejected' ? 500 : 200;
      this.listeners.load();
    });
  }

  abort() {
    this.listeners.abort?.();
  }
}

function arrangeSuccessfulApi() {
  apiFetch.mockImplementation(async (path) => {
    if (path === '/api/files/uploads') {
      return { file: { id: 'file-1' }, partCount: 1, partSizeBytes: 10 };
    }
    if (path === '/api/files/file-1/parts') {
      return { parts: [{ partNumber: 1, url: 'https://storage.example/part' }] };
    }
    if (path === '/api/files/file-1/complete') {
      return { file: { id: 'file-1', status: 'READY' } };
    }
    return null;
  });
}

beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  FakeXMLHttpRequest.behavior = 'success';
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadFile diagnostics and lifecycle', () => {
  it('reports preparation, transfer progress, verification, and success', async () => {
    arrangeSuccessfulApi();
    const phases = [];
    const progress = [];
    const file = new File(['12345'], 'report.pdf', { type: 'application/pdf' });

    const result = await uploadFile(file, {
      onPhase: (phase) => phases.push(phase),
      onProgress: (loaded) => progress.push(loaded),
    });

    expect(phases).toEqual(['preparing', 'uploading', 'verifying']);
    expect(progress).toContain(5);
    expect(result).toEqual({ id: 'file-1', status: 'READY' });
  });

  it('classifies initiation API errors and preserves their request ID', async () => {
    apiFetch.mockRejectedValue(new ApiClientError('internal detail', 500, 'INTERNAL_ERROR', undefined, 'request-1'));

    await expect(uploadFile(new File(['x'], 'report.pdf', { type: 'application/pdf' }), {}))
      .rejects.toMatchObject({ kind: UPLOAD_ERROR_KINDS.API_INITIATION, requestId: 'request-1' });
  });

  it.each([
    ['network', UPLOAD_ERROR_KINDS.STORAGE_NETWORK],
    ['missing-etag', UPLOAD_ERROR_KINDS.MISSING_ETAG],
    ['rejected', UPLOAD_ERROR_KINDS.STORAGE_REJECTED],
  ])('classifies a %s storage response', async (behavior, kind) => {
    arrangeSuccessfulApi();
    FakeXMLHttpRequest.behavior = behavior;

    await expect(uploadFile(new File(['x'], 'report.pdf', { type: 'application/pdf' }), {}))
      .rejects.toMatchObject({ kind });
    expect(apiFetch).toHaveBeenCalledWith('/api/files/file-1', { method: 'DELETE' });
  });

  it('classifies finalization errors and preserves safe correlation data', async () => {
    arrangeSuccessfulApi();
    apiFetch.mockImplementationOnce(async () => ({
      file: { id: 'file-1' }, partCount: 1, partSizeBytes: 10,
    }));
    apiFetch.mockImplementationOnce(async () => ({
      parts: [{ partNumber: 1, url: 'https://storage.example/part' }],
    }));
    apiFetch.mockRejectedValueOnce(new ApiClientError(
      'technical backend message',
      422,
      'FILE_CONTENT_MISMATCH',
      undefined,
      'request-final',
    ));

    await expect(uploadFile(new File(['x'], 'report.pdf', { type: 'application/pdf' }), {}))
      .rejects.toMatchObject({
        kind: UPLOAD_ERROR_KINDS.FINALIZATION,
        code: 'FILE_CONTENT_MISMATCH',
        requestId: 'request-final',
      });
  });
});
