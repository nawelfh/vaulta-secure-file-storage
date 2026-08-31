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
      user: { id: 'user-a', email: 'user@example.com', createdAt: new Date() },
    } : null),
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
  const fileService = {
    list: vi.fn(async ({ ownerId }) => ({ items: [{ id: 'file-1', ownerId }], nextCursor: null })),
    startUpload: vi.fn(),
    signParts: vi.fn(),
    completeUpload: vi.fn(),
    setVisibility: vi.fn(),
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
    storageStatsService,
  };
}

const authCookies = ['session=valid-session', 'csrf=valid-csrf'];

describe('HTTP security boundaries', () => {
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
