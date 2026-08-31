/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('apiFetch request correlation', () => {
  it('preserves the backend error-body request ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'FAILED', message: 'Safe message', requestId: 'body-request' },
    }), { status: 500, headers: { 'content-type': 'application/json', 'x-request-id': 'header-request' } })));

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      code: 'FAILED',
      requestId: 'body-request',
    });
  });

  it('uses the response header when an error body has no request ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', {
      status: 502,
      headers: { 'x-request-id': 'header-request' },
    })));

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      requestId: 'header-request',
    });
  });

  it('returns a useful network error without exposing fetch internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('socket details')));
    await expect(apiFetch('/api/auth/login')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Vaulta could not reach the secure service. Please try again.',
    });
  });

  it('aborts and categorizes a request after its explicit timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => ({
      status: 200,
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    })));
    const request = apiFetch('/api/auth/login', { timeoutMs: 45_000 });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      status: 0,
      message: 'The secure service took too long to respond. Please try again.',
    });
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
  });
});
