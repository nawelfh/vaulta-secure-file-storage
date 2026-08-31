import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('user-name migration', () => {
  it('adds a nullable bounded trimmed name without rewriting existing accounts', async () => {
    const sql = await readFile(new URL('../migrations/002_add_user_name.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/ADD COLUMN name varchar\(100\)/);
    expect(sql).not.toMatch(/NOT NULL|UPDATE users|DEFAULT/i);
    expect(sql).toMatch(/name IS NULL/);
    expect(sql).toMatch(/name = btrim\(name\)/);
  });
});

describe('favorite and Trash migration', () => {
  it('adds backward-compatible persistent state and owner-scoped partial indexes', async () => {
    const sql = await readFile(new URL('../migrations/003_add_file_favorite_and_trash.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/is_favorite boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/trashed_at timestamptz/);
    expect(sql).toMatch(/WHERE status = 'READY' AND trashed_at IS NULL AND is_favorite = true/);
    expect(sql).toMatch(/WHERE status = 'READY' AND trashed_at IS NOT NULL/);
    expect(sql).not.toMatch(/UPDATE files/);
  });
});
