import { describe, expect, it, vi } from 'vitest';

const argon = vi.hoisted(() => ({
  hash: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('argon2', () => ({
  default: {
    argon2id: 2,
    hash: argon.hash,
    verify: argon.verify,
  },
}));

import { DUMMY_PASSWORD_HASH } from '../src/services/auth-service.js';

describe('authentication module startup', () => {
  it('uses a precomputed Argon2id dummy hash without hashing during import', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(argon.hash).not.toHaveBeenCalled();
  });
});
