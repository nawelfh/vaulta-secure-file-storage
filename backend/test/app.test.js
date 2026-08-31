import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { sha256 } from '../src/utils/crypto.js';

function testApp() {
  const config = {
    appOrigin: 'http://localhost:5173',
    cookieName: 'session',
    csrfCookieName: 'csrf',
    isProduction: false,
  };
  const authService = {
    resolveSession: vi.fn(async (token) => token === 'valid-session' ? {
      csrfHash: sha256('valid-csrf'),
      user: { id: 'user-a', name: 'Ada Lovelace', email: 'user@example.com', createdAt: new Date() },
    } : null),
    register: vi.fn(async (input) => ({
      user: { id: 'new-user', name: input.name, email: input.email, createdAt: new Date('2026-01-01') },
      sessionToken: 'new-session', csrfToken: 'new-csrf', expiresAt: new Date('2026-02-01'),
    })),
    login: vi.fn(async (input) => ({
      user: { id: 'user-a', name: null, email: input.email, passwordHash: 'must-not-leak', createdAt: new Date('2025-01-01') },
      sessionToken: 'login-session', csrfToken: 'login-csrf', expiresAt: new Date('2026-02-01'),
    })),
    logout: vi.fn(),
  };
  const fileService = {
    list: vi.fn(async ({ ownerId }) => ({ items: [{ id: 'file-1', ownerId }], nextCursor: null })),
    listPage: vi.fn(async ({ ownerId, page, limit }) => ({
      files: [{ id: 'file-1', ownerId }],
      pagination: { page, limit, total: 1, totalPages: 1, hasPrevious: false, hasNext: false },
    })),
    startUpload: vi.fn(),
    signParts: vi.fn(),
    completeUpload: vi.fn(),
    setVisibility: vi.fn(),
    setFavorite: vi.fn(async ({ favorite }) => ({ id: 'file-1', favorite })),
    moveToTrash: vi.fn(async () => ({ id: 'file-1', trashedAt: new Date('2026-02-01') })),
    restore: vi.fn(async () => ({ id: 'file-1', trashedAt: null })),
    getOwnerDownload: vi.fn(),
    delete: vi.fn(),
    getPublicInfo: vi.fn(async () => ({
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      downloadExpiresIn: 300,
    })),
    getPublicDownload: vi.fn(async () => ({
      url: 'https://storage.example/signed',
      expiresIn: 300,
    })),
  };
  const storageStatsService = {
    getForOwner: vi.fn(async () => ({
      totalFiles: 3,
      publicFiles: 1,
      privateFiles: 2,
      usedBytes: 1024,
      quotaBytes: 1_073_741_824,
      remainingBytes: 1_073_740_800,
      percentageUsed: 0,
    })),
  };
  const pool = { query: vi.fn(async () => ({ rows: [] })) };
  const logger = pino({ level: 'silent' });
  return {
    app: createApp({ config, authService, fileService, storageStatsService, pool, logger }),
    fileService,
    authService,
    storageStatsService,
  };
}

const authCookies = ['session=valid-session', 'csrf=valid-csrf'];

describe('HTTP security boundaries', () => {
  it('requires a trimmed bounded name for signup while login remains compatible with null names', async () => {
    const { app, authService } = testApp();
    const created = await request(app).post('/api/auth/register').send({
      name: '  Ada Lovelace  ', email: 'ADA@example.com', password: 'a sufficiently long password',
    });
    expect(created.status).toBe(201);
    expect(authService.register).toHaveBeenCalledWith({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'a sufficiently long password' });
    expect(created.body.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });

    for (const name of ['   ', 'x'.repeat(101)]) {
      const invalid = await request(app).post('/api/auth/register').send({ name, email: 'new@example.com', password: 'a sufficiently long password' });
      expect(invalid.status).toBe(422);
    }

    const login = await request(app).post('/api/auth/login').send({ email: 'old@example.com', password: 'a sufficiently long password' });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({ id: 'user-a', name: null, email: 'old@example.com', createdAt: '2025-01-01T00:00:00.000Z' });
    expect(login.body.user).not.toHaveProperty('passwordHash');
  });
  it('rejects private file access without authentication', async () => {
    const { app } = testApp();
    const response = await request(app).get('/api/files');
    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('passes the authenticated user ID to owner-scoped operations', async () => {
    const { app, fileService } = testApp();
    const response = await request(app).get('/api/files').set('Cookie', authCookies);
    expect(response.status).toBe(200);
    expect(fileService.list).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-a' }));
  });

  it('validates and passes page, search, sort, and visibility without changing cursor compatibility', async () => {
    const { app, fileService } = testApp();
    const response = await request(app)
      .get('/api/files?page=2&limit=5&search=Report&sort=name-asc&visibility=PUBLIC')
      .set('Cookie', authCookies);
    expect(response.status).toBe(200);
    expect(fileService.listPage).toHaveBeenCalledWith({
      ownerId: 'user-a', page: 2, limit: 5, search: 'Report', sort: 'name-asc', visibility: 'PUBLIC', view: 'active',
    });

    const invalid = await request(app).get('/api/files?page=1&sort=created_at%3BDELETE').set('Cookie', authCookies);
    expect(invalid.status).toBe(422);
    expect(fileService.listPage).toHaveBeenCalledTimes(1);
  });

  it('validates view-specific sorting and forwards Favorites/Trash listing state', async () => {
    const { app, fileService } = testApp();
    const favorites = await request(app).get('/api/files?page=1&limit=5&view=favorites&sort=size-desc').set('Cookie', authCookies);
    expect(favorites.status).toBe(200);
    expect(fileService.listPage).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'favorites', sort: 'size-desc' }));
    const trash = await request(app).get('/api/files?page=1&limit=5&view=trash&sort=deleted-newest').set('Cookie', authCookies);
    expect(trash.status).toBe(200);
    expect(fileService.listPage).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'trash', sort: 'deleted-newest' }));
    expect((await request(app).get('/api/files?page=1&view=trash&sort=newest').set('Cookie', authCookies)).status).toBe(422);
    expect((await request(app).get('/api/files?page=1&view=recent&sort=oldest').set('Cookie', authCookies)).status).toBe(422);
  });

  it('protects favorite, Trash, restore, and permanent-delete mutations with CSRF and owner context', async () => {
    const { app, fileService } = testApp();
    const fileId = '11111111-1111-4111-8111-111111111111';
    const missingCsrf = await request(app).patch(`/api/files/${fileId}/favorite`).set('Cookie', authCookies).send({ favorite: true });
    expect(missingCsrf.status).toBe(403);
    const favorite = await request(app).patch(`/api/files/${fileId}/favorite`).set('Cookie', authCookies).set('x-csrf-token', 'valid-csrf').send({ favorite: true });
    expect(favorite.status).toBe(200);
    expect(fileService.setFavorite).toHaveBeenCalledWith({ ownerId: 'user-a', fileId, favorite: true });
    const trash = await request(app).post(`/api/files/${fileId}/trash`).set('Cookie', authCookies).set('x-csrf-token', 'valid-csrf');
    expect(trash.status).toBe(200);
    expect(fileService.moveToTrash).toHaveBeenCalledWith({ ownerId: 'user-a', fileId });
    const restore = await request(app).post(`/api/files/${fileId}/restore`).set('Cookie', authCookies).set('x-csrf-token', 'valid-csrf');
    expect(restore.status).toBe(200);
    expect(fileService.restore).toHaveBeenCalledWith({ ownerId: 'user-a', fileId });
    const permanent = await request(app).delete(`/api/files/${fileId}`).set('Cookie', authCookies).set('x-csrf-token', 'valid-csrf');
    expect(permanent.status).toBe(204);
    expect(fileService.delete).toHaveBeenCalledWith({ ownerId: 'user-a', fileId });
  });

  it('returns the nullable user name from the current session', async () => {
    const { app } = testApp();
    const response = await request(app).get('/api/auth/me').set('Cookie', authCookies);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ name: 'Ada Lovelace', email: 'user@example.com' });
  });

  it('rejects unauthenticated storage statistics requests', async () => {
    const { app, storageStatsService } = testApp();
    const response = await request(app).get('/api/storage/stats');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(storageStatsService.getForOwner).not.toHaveBeenCalled();
  });

  it('returns owner-scoped storage statistics through a safe authenticated GET', async () => {
    const { app, storageStatsService } = testApp();
    const response = await request(app)
      .get('/api/storage/stats')
      .set('Cookie', ['session=valid-session']);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stats: {
      totalFiles: 3,
      publicFiles: 1,
      privateFiles: 2,
      usedBytes: 1024,
      quotaBytes: 1_073_741_824,
      remainingBytes: 1_073_740_800,
      percentageUsed: 0,
    } });
    expect(storageStatsService.getForOwner).toHaveBeenCalledWith('user-a');
  });

  it('requires a session-bound CSRF token for mutations', async () => {
    const { app } = testApp();
    const missing = await request(app)
      .post('/api/files/uploads')
      .set('Cookie', authCookies)
      .send({ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('INVALID_CSRF_TOKEN');

    const wrong = await request(app)
      .post('/api/files/uploads')
      .set('Cookie', authCookies)
      .set('x-csrf-token', 'wrong')
      .send({ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
    expect(wrong.status).toBe(403);
  });

  it('allows public links without a session and keeps storage URLs behind an explicit download request', async () => {
    const { app, fileService } = testApp();
    const token = 'a'.repeat(43);

    const info = await request(app).get(`/api/public/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      downloadExpiresIn: 300,
    });
    expect(fileService.getPublicInfo).toHaveBeenCalledWith(token);

    const download = await request(app).get(`/api/public/${token}/download`);
    expect(download.status).toBe(200);
    expect(download.body).toEqual({
      url: 'https://storage.example/signed',
      expiresIn: 300,
    });
    expect(fileService.getPublicDownload).toHaveBeenCalledWith(token);
  });

  it('returns structured validation errors and hides unknown routes', async () => {
    const { app } = testApp();
    const invalid = await request(app).get(`/api/public/not-a-token`);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await request(app).get('/not-found');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('blocks cross-site mutations before authentication or business logic', async () => {
    const { app } = testApp();
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'user@example.com', password: 'a sufficiently long password' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('UNTRUSTED_ORIGIN');
  });

  it('returns a structured 413 for oversized JSON', async () => {
    const { app } = testApp();
    const response = await request(app)
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ payload: 'x'.repeat(70 * 1024) }));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('REQUEST_TOO_LARGE');
  });
});
