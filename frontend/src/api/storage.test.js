import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch } from './client.js';
import { getStorageStats } from './storage.js';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

const stats = {
  totalFiles: 3,
  publicFiles: 1,
  privateFiles: 2,
  usedBytes: 1024,
  quotaBytes: 1_073_741_824,
  remainingBytes: 1_073_740_800,
  percentageUsed: 0,
};

afterEach(() => vi.clearAllMocks());

describe('getStorageStats', () => {
  it('returns a valid authoritative stats payload', async () => {
    apiFetch.mockResolvedValue({ stats });

    await expect(getStorageStats({ signal: 'signal' })).resolves.toEqual(stats);
    expect(apiFetch).toHaveBeenCalledWith('/api/storage/stats', { signal: 'signal' });
  });

  it('propagates normal API authentication errors', async () => {
    const error = new ApiClientError('Please sign in.', 401, 'AUTHENTICATION_REQUIRED');
    apiFetch.mockRejectedValue(error);

    await expect(getStorageStats()).rejects.toBe(error);
  });

  it.each([
    [null],
    [{ ...stats, percentageUsed: 120 }],
    [{ ...stats, publicFiles: 2 }],
    [{ ...stats, usedBytes: '1024' }],
  ])('rejects a malformed successful response', async (malformed) => {
    apiFetch.mockResolvedValue({ stats: malformed });

    await expect(getStorageStats()).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_STORAGE_STATS_RESPONSE',
    });
  });
});
