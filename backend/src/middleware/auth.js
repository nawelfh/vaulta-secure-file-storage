import { timingSafeEqual } from 'node:crypto';
import { ApiError } from '../utils/api-error.js';
import { sha256 } from '../utils/crypto.js';

function hashesEqual(first, second) {
  const firstBuffer = Buffer.from(first, 'hex');
  const secondBuffer = Buffer.from(second, 'hex');
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

export function createAuthMiddleware({ authService, config }) {
  async function requireAuth(request, response, next) {
    try {
      const token = request.cookies[config.cookieName];
      const session = await authService.resolveSession(token);
      if (!session) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
      request.auth = { ...session, sessionToken: token };
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireCsrf(request, response, next) {
    const cookieToken = request.cookies[config.csrfCookieName];
    const headerToken = request.get('x-csrf-token');
    if (
      !cookieToken
      || !headerToken
      || cookieToken !== headerToken
      || !hashesEqual(sha256(headerToken), request.auth.csrfHash)
    ) {
      return next(new ApiError(403, 'INVALID_CSRF_TOKEN', 'The security token is missing or invalid.'));
    }
    return next();
  }

  return { requireAuth, requireCsrf };
}
