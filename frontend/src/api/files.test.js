/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client.js';
import { getFiles } from './files.js';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

const pagination = { page: 2, limit: 5, total: 8, totalPages: 2, hasPrevious: true, hasNext: false };

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ files: [], pagination });
});

describe('getFiles', () => {
  it('encodes page, search, fixed sort, and visibility parameters', async () => {
    const controller = new AbortController();
    await expect(getFiles({ page: 2, limit: 5, search: 'Q3 & plans', sort: 'name-asc', visibility: 'PUBLIC', signal: controller.signal }))
      .resolves.toEqual({ files: [], pagination });
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/files?page=2&limit=5&sort=name-asc&view=active&search=Q3+%26+plans&visibility=PUBLIC',
      { signal: controller.signal },
    );
  });

  it('encodes persisted Favorites and Trash views with their fixed sorts', async () => {
    await getFiles({ view: 'favorites', sort: 'size-desc' });
    expect(apiFetch).toHaveBeenLastCalledWith('/api/files?page=1&limit=5&sort=size-desc&view=favorites', { signal: undefined });
    await getFiles({ view: 'trash', sort: 'deleted-newest', search: 'old file' });
    expect(apiFetch).toHaveBeenLastCalledWith('/api/files?page=1&limit=5&sort=deleted-newest&view=trash&search=old+file', { signal: undefined });
  });

  it('refuses unknown sorts locally and malformed server metadata', async () => {
    await expect(getFiles({ sort: 'created_at;drop' })).rejects.toThrow('Unsupported file sort option');
    expect(apiFetch).not.toHaveBeenCalled();
    apiFetch.mockResolvedValue({ files: [], pagination: { page: 1 } });
    await expect(getFiles()).rejects.toMatchObject({ code: 'INVALID_FILE_LIST_RESPONSE' });
  });
});
