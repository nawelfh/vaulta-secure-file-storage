import { describe, expect, it, vi } from 'vitest';
import { createFileService } from '../src/services/file-service.js';

function createHarness({ prefix = Buffer.from('%PDF-1.7') } = {}) {
  const records = new Map();
  let objectExists = false;
  const files = {
    createUpload: vi.fn(async (file) => {
      const record = {
        ...file,
        status: 'UPLOADING',
        visibility: 'PRIVATE',
        shareToken: null,
        isFavorite: false,
        trashedAt: null,
        rejectionReason: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      records.set(record.id, record);
      return record;
    }),
    findOwned: vi.fn(async (id, ownerId) => {
      const record = records.get(id);
      return record?.ownerId === ownerId ? record : null;
    }),
    findPublic: vi.fn(async (token) => [...records.values()].find(
      (record) => record.shareToken === token && record.visibility === 'PUBLIC' && record.status === 'READY' && !record.trashedAt,
    ) || null),
    listOwned: vi.fn(async ({ ownerId }) => ({
      items: [...records.values()].filter((record) => record.ownerId === ownerId && !record.trashedAt),
      nextCursor: null,
    })),
    listOwnedPage: vi.fn(async ({ ownerId, page, limit, view = 'active', visibility }) => {
      const owned = [...records.values()].filter((record) => record.ownerId === ownerId
        && record.status === 'READY'
        && (view === 'trash' ? Boolean(record.trashedAt) : !record.trashedAt)
        && (view !== 'favorites' || record.isFavorite)
        && (!visibility || record.visibility === visibility));
      return {
        files: owned.slice((page - 1) * limit, page * limit),
        pagination: { page, limit, total: owned.length, totalPages: Math.ceil(owned.length / limit), hasPrevious: page > 1, hasNext: page * limit < owned.length },
      };
    }),
    markReady: vi.fn(async ({ id }) => {
      const record = records.get(id);
      Object.assign(record, { status: 'READY', multipartUploadId: null });
      return record;
    }),
    markRejected: vi.fn(async ({ id, reason }) => {
      const record = records.get(id);
      Object.assign(record, { status: 'REJECTED', multipartUploadId: null, rejectionReason: reason });
      return record;
    }),
    updateVisibility: vi.fn(async ({ id, visibility, shareToken }) => {
      const record = records.get(id);
      Object.assign(record, { visibility, shareToken });
      return record;
    }),
    updateFavorite: vi.fn(async ({ id, favorite }) => {
      const record = records.get(id);
      Object.assign(record, { isFavorite: favorite });
      return record;
    }),
    moveToTrash: vi.fn(async ({ id }) => {
      const record = records.get(id);
      Object.assign(record, { trashedAt: new Date('2026-02-01T00:00:00Z') });
      return record;
    }),
    restoreFromTrash: vi.fn(async ({ id }) => {
      const record = records.get(id);
      Object.assign(record, { trashedAt: null });
      return record;
    }),
    deleteTrashed: vi.fn(async (id) => {
      const record = records.get(id);
      records.delete(id);
      return record;
    }),
    deleteOwned: vi.fn(async (id) => records.delete(id)),
  };
  const storage = {
    partSizeBytes: 10,
    signedUrlTtlSeconds: 300,
    createMultipart: vi.fn(async () => 'upload-1'),
    signPart: vi.fn(async ({ partNumber }) => `https://storage.example/part/${partNumber}`),
    completeMultipart: vi.fn(async () => { objectExists = true; }),
    abortMultipart: vi.fn(async () => {}),
    head: vi.fn(async () => objectExists ? { sizeBytes: 15, contentType: 'application/pdf' } : null),
    readPrefix: vi.fn(async () => prefix),
    delete: vi.fn(async () => { objectExists = false; }),
    signDownload: vi.fn(async () => 'https://storage.example/download'),
  };
  const config = {
    appOrigin: 'https://vaulta.example',
    maxFileSizeBytes: 250 * 1024 * 1024,
  };
  return { service: createFileService({ files, storage, config }), files, storage, records };
}

async function startPdf(harness) {
  return harness.service.startUpload({
    ownerId: 'user-a',
    metadata: { originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 15 },
  });
}

describe('file service authorization and lifecycle', () => {
  it('creates private uploads with opaque owner-scoped keys', async () => {
    const harness = createHarness();
    const result = await startPdf(harness);
    const stored = harness.records.get(result.file.id);
    expect(result).toMatchObject({ partSizeBytes: 10, partCount: 2 });
    expect(result.file.visibility).toBe('PRIVATE');
    expect(stored.storageKey).toMatch(/^user-a\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+$/);
    expect(stored.storageKey).not.toContain('report.pdf');
  });

  it('does not reveal whether another user owns a file', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await expect(harness.service.signParts({
      ownerId: 'user-b',
      fileId: file.id,
      partNumbers: [1, 2],
    })).rejects.toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
  });

  it('rejects duplicate or out-of-range part numbers', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await expect(harness.service.signParts({
      ownerId: 'user-a',
      fileId: file.id,
      partNumbers: [1, 1],
    })).rejects.toMatchObject({ code: 'INVALID_PART_NUMBERS' });
  });

  it('signs only requested valid parts and rejects incomplete completion', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    const signed = await harness.service.signParts({
      ownerId: 'user-a', fileId: file.id, partNumbers: [2, 1],
    });
    expect(signed).toEqual([
      { partNumber: 1, url: 'https://storage.example/part/1' },
      { partNumber: 2, url: 'https://storage.example/part/2' },
    ]);
    await expect(harness.service.completeUpload({
      ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }],
    })).rejects.toMatchObject({ code: 'INCOMPLETE_PART_LIST' });
  });

  it('completes every part, checks storage metadata and marks the file ready', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    const completed = await harness.service.completeUpload({
      ownerId: 'user-a',
      fileId: file.id,
      parts: [{ partNumber: 2, etag: 'etag-2' }, { partNumber: 1, etag: 'etag-1' }],
    });
    expect(completed.status).toBe('READY');
    expect(harness.storage.readPrefix).toHaveBeenCalledWith(expect.any(String), 4096);
    expect(harness.storage.completeMultipart).toHaveBeenCalledWith(expect.objectContaining({
      parts: [{ partNumber: 1, etag: 'etag-1' }, { partNumber: 2, etag: 'etag-2' }],
    }));
    expect(harness.files.markReady).toHaveBeenCalled();
  });

  it('deletes and rejects an object whose magic bytes do not match', async () => {
    const harness = createHarness({ prefix: Buffer.from('<html>') });
    const { file } = await startPdf(harness);
    await expect(harness.service.completeUpload({
      ownerId: 'user-a',
      fileId: file.id,
      parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }],
    })).rejects.toMatchObject({ code: 'FILE_CONTENT_MISMATCH' });
    expect(harness.storage.delete).toHaveBeenCalled();
    expect(harness.files.markRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: 'CONTENT_TYPE_MISMATCH' }));
  });

  it('creates revocable public links without exposing storage keys', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({
      ownerId: 'user-a', fileId: file.id,
      parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }],
    });
    const shared = await harness.service.setVisibility({ ownerId: 'user-a', fileId: file.id, visibility: 'PUBLIC' });
    expect(shared.shareUrl).toMatch(/^https:\/\/vaulta\.example\/share\/[A-Za-z0-9_-]{43}$/);
    expect(shared.shareUrl).not.toContain(harness.records.get(file.id).storageKey);

    const shareToken = harness.records.get(file.id).shareToken;
    const info = await harness.service.getPublicInfo(shareToken);
    expect(info).toEqual({
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 15,
      downloadExpiresIn: 300,
    });

    const download = await harness.service.getPublicDownload(shareToken);
    expect(download).toEqual({
      url: 'https://storage.example/download',
      expiresIn: 300,
    });

    const privateAgain = await harness.service.setVisibility({ ownerId: 'user-a', fileId: file.id, visibility: 'PRIVATE' });
    expect(privateAgain.shareUrl).toBeNull();
    await expect(harness.service.getPublicInfo(shareToken))
      .rejects.toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
    await expect(harness.service.getPublicDownload(shareToken))
      .rejects.toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
  });

  it('lists only owned records and issues owner downloads', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({
      ownerId: 'user-a', fileId: file.id,
      parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }],
    });
    const listed = await harness.service.list({ ownerId: 'user-a', limit: 20 });
    expect(listed.items).toHaveLength(1);
    const download = await harness.service.getOwnerDownload({ ownerId: 'user-a', fileId: file.id });
    expect(download).toEqual({ url: 'https://storage.example/download', expiresIn: 300 });
  });

  it('serializes authoritative page results without exposing storage metadata', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({ ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] });
    const result = await harness.service.listPage({ ownerId: 'user-a', page: 1, limit: 5, search: 'report', sort: 'newest' });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).not.toHaveProperty('storageKey');
    expect(result.pagination).toMatchObject({ page: 1, limit: 5, total: 1 });
  });

  it('aborts unfinished uploads before deleting their database record', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.delete({ ownerId: 'user-a', fileId: file.id });
    expect(harness.storage.abortMultipart).toHaveBeenCalled();
    expect(harness.files.deleteOwned).toHaveBeenCalledWith(file.id, 'user-a');
  });

  it('persists favorite state for active owned files and rejects cross-owner access', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({ ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] });
    const favorite = await harness.service.setFavorite({ ownerId: 'user-a', fileId: file.id, favorite: true });
    expect(favorite.favorite).toBe(true);
    expect(harness.records.get(file.id).isFavorite).toBe(true);
    const unfavorite = await harness.service.setFavorite({ ownerId: 'user-a', fileId: file.id, favorite: false });
    expect(unfavorite.favorite).toBe(false);
    await expect(harness.service.setFavorite({ ownerId: 'user-b', fileId: file.id, favorite: true }))
      .rejects.toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
  });

  it('moves an owned READY file to Trash without deleting storage and restores its state', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({ ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] });
    await harness.service.setVisibility({ ownerId: 'user-a', fileId: file.id, visibility: 'PUBLIC' });
    await harness.service.setFavorite({ ownerId: 'user-a', fileId: file.id, favorite: true });
    const token = harness.records.get(file.id).shareToken;
    const trashed = await harness.service.moveToTrash({ ownerId: 'user-a', fileId: file.id });
    expect(trashed).toMatchObject({ favorite: true, visibility: 'PUBLIC', shareUrl: null });
    expect(harness.storage.delete).not.toHaveBeenCalled();
    await expect(harness.service.getPublicInfo(token)).rejects.toMatchObject({ status: 404 });
    await expect(harness.service.getOwnerDownload({ ownerId: 'user-a', fileId: file.id })).rejects.toMatchObject({ code: 'FILE_NOT_ACTIVE' });
    const restored = await harness.service.restore({ ownerId: 'user-a', fileId: file.id });
    expect(restored).toMatchObject({ favorite: true, visibility: 'PUBLIC' });
    expect(restored.shareUrl).toContain('/share/');
  });

  it('rejects cross-owner Trash/restore and active-file permanent deletion', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({ ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] });
    await expect(harness.service.moveToTrash({ ownerId: 'user-b', fileId: file.id })).rejects.toMatchObject({ status: 404 });
    await expect(harness.service.restore({ ownerId: 'user-b', fileId: file.id })).rejects.toMatchObject({ status: 404 });
    await expect(harness.service.delete({ ownerId: 'user-b', fileId: file.id })).rejects.toMatchObject({ status: 404 });
    await expect(harness.service.delete({ ownerId: 'user-a', fileId: file.id })).rejects.toMatchObject({ code: 'FILE_NOT_TRASHED' });
    expect(harness.storage.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid repeated Trash, favorite, and restore transitions', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({ ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] });
    await harness.service.moveToTrash({ ownerId: 'user-a', fileId: file.id });
    await expect(harness.service.moveToTrash({ ownerId: 'user-a', fileId: file.id })).rejects.toMatchObject({ code: 'FILE_NOT_ACTIVE' });
    await expect(harness.service.setFavorite({ ownerId: 'user-a', fileId: file.id, favorite: true })).rejects.toMatchObject({ code: 'FILE_NOT_ACTIVE' });
    await harness.service.restore({ ownerId: 'user-a', fileId: file.id });
    await expect(harness.service.restore({ ownerId: 'user-a', fileId: file.id })).rejects.toMatchObject({ code: 'FILE_NOT_TRASHED' });
  });

  it('permanently deletes object storage and metadata only after Trash', async () => {
    const harness = createHarness();
    const { file } = await startPdf(harness);
    await harness.service.completeUpload({ ownerId: 'user-a', fileId: file.id, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] });
    await harness.service.moveToTrash({ ownerId: 'user-a', fileId: file.id });
    await harness.service.delete({ ownerId: 'user-a', fileId: file.id });
    expect(harness.storage.delete).toHaveBeenCalledTimes(1);
    expect(harness.files.deleteTrashed).toHaveBeenCalledWith(file.id, 'user-a');
    expect(harness.records.has(file.id)).toBe(false);
  });
});
