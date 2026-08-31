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
    expect(sql).toMatch(/COUNT\(\*\) AS total_files/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE visibility = 'PUBLIC'\)/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE visibility = 'PRIVATE'\)/);
    expect(sql).toMatch(/COALESCE\(SUM\(size_bytes\), 0\)/);
    expect(sql).toMatch(/owner_id = \$1/);
    expect(sql).toMatch(/status = 'READY'/);
    expect(sql).not.toMatch(/LIMIT|OFFSET|cursor/i);
    expect(sql).not.toMatch(/UPLOADING|REJECTED/);
  });
});
