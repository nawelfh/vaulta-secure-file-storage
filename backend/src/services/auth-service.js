import argon2 from 'argon2';
import { ApiError } from '../utils/api-error.js';
import { randomToken, sha256 } from '../utils/crypto.js';

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$uNaECBWKJt6YVFbT1tDdSw$fob54OZzCzqHImTU4xJMfw4Q684CkYpgR6HHkxnN/sw';

export function createAuthService({ users, sessions, sessionTtlHours }) {
  async function issueSession(userId) {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
    await sessions.create({
      userId,
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      expiresAt,
    });
    return { sessionToken, csrfToken, expiresAt };
  }

  return {
    async register({ name, email, password }) {
      const passwordHash = await argon2.hash(password, argonOptions);
      let user;
      try {
        user = await users.create({ name, email, passwordHash });
      } catch (error) {
        if (error.code === '23505') {
          throw new ApiError(409, 'EMAIL_ALREADY_USED', 'An account already exists for this email.');
        }
        throw error;
      }
      return { user, ...(await issueSession(user.id)) };
    },

    async login({ email, password }) {
      const user = await users.findByEmail(email);
      const candidateHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
      const valid = await argon2.verify(candidateHash, password);
      if (!user || !valid) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
      }
      return { user, ...(await issueSession(user.id)) };
    },

    async resolveSession(sessionToken) {
      if (!sessionToken) return null;
      return sessions.findValid(sha256(sessionToken));
    },

    async logout(sessionToken) {
      if (sessionToken) await sessions.deleteByTokenHash(sha256(sessionToken));
    },
  };
}
