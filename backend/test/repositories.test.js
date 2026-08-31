import { describe, expect, it, vi } from 'vitest';
import { createRepositories } from '../src/db/repositories.js';

describe('file repository storage aggregate', () => {
  it('uses one owner-scoped READY-only aggregate query independent of pagination', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{
        total_files: '300',
        public_files: '125',
        private_files: '175',
        used_bytes: '786432000',
      }] })),
    };
    const repositories = createRepositories(pool);

    await expect(repositories.files.getReadyStorageStats('owner-a')).resolves.toEqual({
      totalFiles: '300',
      publicFiles: '125',
      privateFiles: '175',
      usedBytes: '786432000',
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = pool.query.mock.calls[0];
    expect(parameters).toEqual(['owner-a']);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE trashed_at IS NULL\) AS total_files/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE trashed_at IS NULL AND visibility = 'PUBLIC'\)/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE trashed_at IS NULL AND visibility = 'PRIVATE'\)/);
    expect(sql).toMatch(/COALESCE\(SUM\(size_bytes\), 0\)/);
    expect(sql).toMatch(/owner_id = \$1/);
    expect(sql).toMatch(/status = 'READY'/);
    expect(sql).toMatch(/SUM\(size_bytes\)/);
    expect(sql).not.toMatch(/LIMIT|OFFSET|cursor/i);
    expect(sql).not.toMatch(/UPLOADING|REJECTED/);
  });
});

describe('file repository page queries', () => {
  const row = {
    id: 'file-1', owner_id: 'owner-a', original_name: 'Report_100%.PDF', storage_key: 'opaque',
    mime_type: 'application/pdf', size_bytes: '1024', status: 'READY', visibility: 'PUBLIC',
    share_token: null, multipart_upload_id: null, rejection_reason: null,
    created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
  };

  it.each([
    ['newest', /created_at DESC, id DESC/],
    ['oldest', /created_at ASC, id ASC/],
    ['name-asc', /lower\(original_name\) ASC, original_name ASC, id ASC/],
    ['name-desc', /lower\(original_name\) DESC, original_name DESC, id DESC/],
    ['size-asc', /size_bytes ASC, id ASC/],
    ['size-desc', /size_bytes DESC, id DESC/],
  ])('uses a fixed deterministic clause for %s', async (sort, expectedOrder) => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ total: '1' }] }).mockResolvedValueOnce({ rows: [row] }) };
    const repositories = createRepositories(pool);
    const result = await repositories.files.listOwnedPage({ ownerId: 'owner-a', page: 1, limit: 5, sort });
    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 1, totalPages: 1, hasPrevious: false, hasNext: false });
    expect(result.files[0]).toMatchObject({ id: 'file-1', sizeBytes: 1024 });
    expect(pool.query.mock.calls[1][0]).toMatch(expectedOrder);
    expect(pool.query.mock.calls[1][0]).toMatch(/owner_id = \$1[\s\S]*status = 'READY'/);
  });

  it('escapes SQL wildcard characters, scopes visibility, and clamps a stale final page', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ total: '6' }] }).mockResolvedValueOnce({ rows: [row] }) };
    const repositories = createRepositories(pool);
    const result = await repositories.files.listOwnedPage({
      ownerId: 'owner-a', page: 3, limit: 5, search: 'Report_100%', sort: 'newest', visibility: 'PUBLIC',
    });
    expect(pool.query.mock.calls[0][1]).toEqual(['owner-a', '%Report\\_100\\%%', 'PUBLIC']);
    expect(pool.query.mock.calls[0][0]).toMatch(/ILIKE \$2 ESCAPE '\\'/);
    expect(pool.query.mock.calls[0][0]).toMatch(/visibility = \$3/);
    expect(pool.query.mock.calls[1][1]).toEqual(['owner-a', '%Report\\_100\\%%', 'PUBLIC', 5, 5]);
    expect(result.pagination).toMatchObject({ page: 2, totalPages: 2, hasPrevious: true, hasNext: false });
  });

  it('returns an empty first page and refuses an arbitrary sort fragment', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ total: '0' }] }).mockResolvedValueOnce({ rows: [] }) };
    const repositories = createRepositories(pool);
    await expect(repositories.files.listOwnedPage({ ownerId: 'owner-a', page: 1, limit: 5, sort: 'newest' }))
      .resolves.toMatchObject({ files: [], pagination: { page: 1, total: 0, totalPages: 0 } });
    await expect(repositories.files.listOwnedPage({ ownerId: 'owner-a', page: 1, limit: 5, sort: 'id; DROP TABLE files' }))
      .rejects.toThrow('Unsupported file sort option');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('translates only whitelisted Favorites and Trash views into fixed predicates', async () => {
    const favoritesPool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ total: '0' }] }).mockResolvedValueOnce({ rows: [] }) };
    await createRepositories(favoritesPool).files.listOwnedPage({ ownerId: 'owner-a', page: 1, limit: 5, sort: 'newest', view: 'favorites' });
    expect(favoritesPool.query.mock.calls[0][0]).toMatch(/trashed_at IS NULL[\s\S]*is_favorite = true/);

    const trashPool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ total: '0' }] }).mockResolvedValueOnce({ rows: [] }) };
    await createRepositories(trashPool).files.listOwnedPage({ ownerId: 'owner-a', page: 1, limit: 5, sort: 'deleted-newest', view: 'trash' });
    expect(trashPool.query.mock.calls[0][0]).toMatch(/trashed_at IS NOT NULL/);
    expect(trashPool.query.mock.calls[1][0]).toMatch(/ORDER BY trashed_at DESC, id DESC/);

    await expect(createRepositories({ query: vi.fn() }).files.listOwnedPage({ ownerId: 'owner-a', page: 1, limit: 5, sort: 'newest', view: 'injected OR true' }))
      .rejects.toThrow('Unsupported file view');
  });
});
