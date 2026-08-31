import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/db/repositories.js';

const databaseUrl = process.env.DATABASE_URL || 'postgres://secure_store:secure_store@localhost:5432/secure_store';
const pool = new pg.Pool({ connectionString: databaseUrl });
let client;
let repositories;
let ownerId;
let otherOwnerId;
let emptyOwnerId;

function shareToken(index) {
  return `${String(index).padStart(2, '0')}${'s'.repeat(41)}`;
}

async function insertFile({ owner, name, size, visibility = 'PRIVATE', status = 'READY', createdAt, index }) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO files(
       id, owner_id, original_name, storage_key, mime_type, size_bytes,
       status, visibility, share_token, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8, $9, $9)`,
    [id, owner, name, `integration/${id}`, size, status, visibility, visibility === 'PUBLIC' ? shareToken(index) : null, createdAt],
  );
  return id;
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  ownerId = randomUUID();
  otherOwnerId = randomUUID();
  emptyOwnerId = randomUUID();
  await client.query(
    `INSERT INTO users(id, name, email, password_hash) VALUES
       ($1, 'Owner One', $4, 'hash'),
       ($2, 'Owner Two', $5, 'hash'),
       ($3, NULL, $6, 'hash')`,
    [ownerId, otherOwnerId, emptyOwnerId, `${ownerId}@example.com`, `${otherOwnerId}@example.com`, `${emptyOwnerId}@example.com`],
  );
  const names = ['Alpha.pdf', 'beta.pdf', 'Gamma.pdf', 'delta.pdf', 'epsilon.pdf', 'zeta.pdf', 'eta.pdf', 'theta.pdf', 'iota.pdf', 'kappa.pdf', 'Report_100%_done.pdf'];
  for (const [index, name] of names.entries()) {
    await insertFile({
      owner: ownerId,
      name,
      size: (index + 1) * 100,
      visibility: index % 2 ? 'PUBLIC' : 'PRIVATE',
      createdAt: new Date(Date.UTC(2026, 0, index < 2 ? 1 : index + 1)),
      index,
    });
  }
  await insertFile({ owner: otherOwnerId, name: 'REPORT-other-owner.pdf', size: 1, createdAt: new Date(), index: 30 });
  await insertFile({ owner: ownerId, name: 'report-uploading.pdf', size: 1, status: 'UPLOADING', createdAt: new Date(), index: 31 });
  await insertFile({ owner: ownerId, name: 'report-rejected.pdf', size: 1, status: 'REJECTED', createdAt: new Date(), index: 32 });
  repositories = createRepositories(client);
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

describe('numbered file list against PostgreSQL', () => {
  it('enforces owner/READY search semantics and treats wildcard characters literally', async () => {
    const match = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, search: 'rEpOrT', sort: 'newest' });
    expect(match.pagination.total).toBe(1);
    expect(match.files.map((file) => file.originalName)).toEqual(['Report_100%_done.pdf']);

    const wildcard = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, search: '100%_done', sort: 'newest' });
    expect(wildcard.pagination.total).toBe(1);
    const noResults = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, search: 'missing', sort: 'newest' });
    expect(noResults).toMatchObject({ files: [], pagination: { page: 1, total: 0, totalPages: 0 } });
  });

  it('returns exact five-row pages, totals, middle and final pages, and an empty account', async () => {
    const first = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, sort: 'newest' });
    const middle = await repositories.files.listOwnedPage({ ownerId, page: 2, limit: 5, sort: 'newest' });
    const final = await repositories.files.listOwnedPage({ ownerId, page: 3, limit: 5, sort: 'newest' });
    expect(first.files).toHaveLength(5);
    expect(middle.files).toHaveLength(5);
    expect(final.files).toHaveLength(1);
    expect(first.pagination).toEqual({ page: 1, limit: 5, total: 11, totalPages: 3, hasPrevious: false, hasNext: true });
    expect(middle.pagination).toMatchObject({ page: 2, hasPrevious: true, hasNext: true });
    expect(final.pagination).toMatchObject({ page: 3, hasPrevious: true, hasNext: false });

    const empty = await repositories.files.listOwnedPage({ ownerId: emptyOwnerId, page: 1, limit: 5, sort: 'newest' });
    expect(empty).toMatchObject({ files: [], pagination: { page: 1, total: 0, totalPages: 0 } });
  });

  it('combines visibility and search with pagination', async () => {
    const publicPage = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, sort: 'newest', visibility: 'PUBLIC' });
    expect(publicPage.pagination.total).toBe(5);
    expect(publicPage.files).toHaveLength(5);
    expect(publicPage.files.every((file) => file.visibility === 'PUBLIC')).toBe(true);
    const privateSearch = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, search: 'alpha', sort: 'newest', visibility: 'PRIVATE' });
    expect(privateSearch.files.map((file) => file.originalName)).toEqual(['Alpha.pdf']);
  });

  it.each([
    ['newest', (files) => files.map((file) => file.createdAt.getTime())],
    ['oldest', (files) => files.map((file) => file.createdAt.getTime())],
    ['name-asc', (files) => files.map((file) => file.originalName.toLowerCase())],
    ['name-desc', (files) => files.map((file) => file.originalName.toLowerCase())],
    ['size-asc', (files) => files.map((file) => file.sizeBytes)],
    ['size-desc', (files) => files.map((file) => file.sizeBytes)],
  ])('orders %s deterministically', async (sort, project) => {
    const result = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, sort });
    const values = project(result.files);
    const expected = [...values].sort((left, right) => {
      if (typeof left === 'string') return left.localeCompare(right);
      return left - right;
    });
    if (sort.endsWith('desc') || sort === 'newest') expected.reverse();
    expect(values).toEqual(expected);
    expect(new Set(result.files.map((file) => file.id)).size).toBe(result.files.length);
  });

  it('clamps to the previous page after deleting the final item on a page', async () => {
    const final = await repositories.files.listOwnedPage({ ownerId, page: 3, limit: 5, sort: 'newest' });
    expect(final.files).toHaveLength(1);
    await repositories.files.deleteOwned(final.files[0].id, ownerId);
    const refreshed = await repositories.files.listOwnedPage({ ownerId, page: 3, limit: 5, sort: 'newest' });
    expect(refreshed.pagination).toMatchObject({ page: 2, total: 10, totalPages: 2, hasNext: false });
    expect(refreshed.files).toHaveLength(5);
  });

  it('persists Favorites and enforces active/Trash/stat/public-link semantics', async () => {
    await client.query(
      `WITH selected AS (
         SELECT id FROM files
          WHERE owner_id = $1 AND status = 'READY' AND trashed_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 7
       ) UPDATE files SET is_favorite = true WHERE id IN (SELECT id FROM selected)`,
      [ownerId],
    );
    const favoritesFirst = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, view: 'favorites', sort: 'newest' });
    const favoritesFinal = await repositories.files.listOwnedPage({ ownerId, page: 2, limit: 5, view: 'favorites', sort: 'newest' });
    expect(favoritesFirst.pagination).toMatchObject({ total: 7, totalPages: 2, hasNext: true });
    expect(favoritesFirst.files).toHaveLength(5);
    expect(favoritesFinal.files).toHaveLength(2);
    expect(favoritesFirst.files.every((file) => file.isFavorite && !file.trashedAt)).toBe(true);
    expect((await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, view: 'favorites', sort: 'name-asc', search: favoritesFirst.files[0].originalName })).pagination.total).toBe(1);
    expect((await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, view: 'favorites', sort: 'newest', visibility: 'PUBLIC' })).files.every((file) => file.visibility === 'PUBLIC')).toBe(true);
    expect((await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, view: 'favorites', sort: 'newest', visibility: 'PRIVATE' })).files.every((file) => file.visibility === 'PRIVATE')).toBe(true);

    const target = favoritesFirst.files.find((file) => file.visibility === 'PUBLIC');
    const secondTarget = favoritesFirst.files.find((file) => file.id !== target.id);
    const statsBefore = await repositories.files.getReadyStorageStats(ownerId);
    expect(await repositories.files.findPublic(target.shareToken)).toMatchObject({ id: target.id });
    const firstTrashed = await repositories.files.moveToTrash({ id: target.id, ownerId });
    await repositories.files.moveToTrash({ id: secondTarget.id, ownerId });
    await client.query('UPDATE files SET trashed_at = trashed_at + interval \'1 second\' WHERE id = $1', [secondTarget.id]);
    expect(firstTrashed).toMatchObject({ isFavorite: true, visibility: 'PUBLIC' });
    expect(await repositories.files.findPublic(target.shareToken)).toBeFalsy();

    const active = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 50, view: 'active', sort: 'newest' });
    const favoriteActive = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 50, view: 'favorites', sort: 'newest' });
    const sharedActive = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 50, view: 'active', sort: 'newest', visibility: 'PUBLIC' });
    expect(active.files.some((file) => file.id === target.id)).toBe(false);
    expect(favoriteActive.files.some((file) => file.id === target.id)).toBe(false);
    expect(sharedActive.files.some((file) => file.id === target.id)).toBe(false);

    const trash = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 1, view: 'trash', sort: 'deleted-newest' });
    expect(trash.pagination).toMatchObject({ total: 2, totalPages: 2, hasNext: true });
    expect(trash.files[0].id).toBe(secondTarget.id);
    const trashSearch = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 5, view: 'trash', sort: 'deleted-oldest', search: target.originalName });
    expect(trashSearch.files.map((file) => file.id)).toEqual([target.id]);

    const statsTrashed = await repositories.files.getReadyStorageStats(ownerId);
    expect(Number(statsTrashed.totalFiles)).toBe(Number(statsBefore.totalFiles) - 2);
    expect(Number(statsTrashed.usedBytes)).toBe(Number(statsBefore.usedBytes));

    await repositories.files.deleteTrashed(secondTarget.id, ownerId);
    const recoveredTrashPage = await repositories.files.listOwnedPage({ ownerId, page: 2, limit: 1, view: 'trash', sort: 'deleted-newest' });
    expect(recoveredTrashPage.pagination).toMatchObject({ page: 1, total: 1, totalPages: 1, hasNext: false });
    const statsDeleted = await repositories.files.getReadyStorageStats(ownerId);
    expect(Number(statsDeleted.usedBytes)).toBe(Number(statsBefore.usedBytes) - secondTarget.sizeBytes);

    const restored = await repositories.files.restoreFromTrash({ id: target.id, ownerId });
    expect(restored).toMatchObject({ isFavorite: true, visibility: 'PUBLIC', trashedAt: null });
    expect(await repositories.files.findPublic(target.shareToken)).toMatchObject({ id: target.id });
    const statsRestored = await repositories.files.getReadyStorageStats(ownerId);
    expect(Number(statsRestored.totalFiles)).toBe(Number(statsBefore.totalFiles) - 1);
    expect(Number(statsRestored.usedBytes)).toBe(Number(statsBefore.usedBytes) - secondTarget.sizeBytes);
    await repositories.files.updateFavorite({ id: target.id, ownerId, favorite: false });
    const afterUnfavorite = await repositories.files.listOwnedPage({ ownerId, page: 1, limit: 50, view: 'favorites', sort: 'newest' });
    expect(afterUnfavorite.files.some((file) => file.id === target.id)).toBe(false);
  });
});
