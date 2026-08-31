import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../src/services/auth-service.js';
import { sha256 } from '../src/utils/crypto.js';

function harness(existingUser = null) {
  const users = {
    create: vi.fn(async ({ name, email, passwordHash }) => ({
      id: 'user-1', name, email, passwordHash, createdAt: new Date(),
    })),
    findByEmail: vi.fn(async () => existingUser),
  };
  const sessions = {
    create: vi.fn(async () => {}),
    findValid: vi.fn(async () => null),
    deleteByTokenHash: vi.fn(async () => {}),
  };
  return { service: createAuthService({ users, sessions, sessionTtlHours: 24 }), users, sessions };
}

describe('authentication service', () => {
  it('hashes passwords and stores only hashes of session secrets', async () => {
    const { service, users, sessions } = harness();
    const result = await service.register({ name: 'Ada Lovelace', email: 'user@example.com', password: 'correct horse battery staple' });
    const passwordHash = users.create.mock.calls[0][0].passwordHash;
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(passwordHash, 'correct horse battery staple')).toBe(true);
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ada Lovelace' }));

    const storedSession = sessions.create.mock.calls[0][0];
    expect(storedSession.tokenHash).toBe(sha256(result.sessionToken));
    expect(storedSession.csrfHash).toBe(sha256(result.csrfToken));
    expect(storedSession.tokenHash).not.toBe(result.sessionToken);
  });

  it('returns one generic error for unknown users and wrong passwords', async () => {
    const unknown = harness();
    await expect(unknown.service.login({ email: 'missing@example.com', password: 'anything at all' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });

    const passwordHash = await argon2.hash('right password');
    const known = harness({ id: 'user-1', email: 'user@example.com', passwordHash });
    await expect(known.service.login({ email: 'user@example.com', password: 'wrong password' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('resolves and revokes sessions by a SHA-256 token hash', async () => {
    const { service, sessions } = harness();
    sessions.findValid.mockResolvedValue({ user: { id: 'user-1' } });
    await service.resolveSession('raw-secret');
    await service.logout('raw-secret');
    expect(sessions.findValid).toHaveBeenCalledWith(sha256('raw-secret'));
    expect(sessions.deleteByTokenHash).toHaveBeenCalledWith(sha256('raw-secret'));
  });
});
