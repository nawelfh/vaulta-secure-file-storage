/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client.js';

afterEach(() => {
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
});
