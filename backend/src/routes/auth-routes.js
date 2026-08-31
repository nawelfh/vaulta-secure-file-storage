import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12, 'Use at least 12 characters.').max(128),
}).strict();

const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
}).strict();

function userResponse(user) {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function setSessionCookies(response, config, session) {
  const shared = {
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  };
  response.cookie(config.cookieName, session.sessionToken, { ...shared, httpOnly: true });
  response.cookie(config.csrfCookieName, session.csrfToken, { ...shared, httpOnly: false });
}

function clearSessionCookies(response, config) {
  const options = { secure: config.isProduction, sameSite: 'lax', path: '/' };
  response.clearCookie(config.cookieName, { ...options, httpOnly: true });
  response.clearCookie(config.csrfCookieName, { ...options, httpOnly: false });
}

export function createAuthRouter({ authService, auth, config }) {
  const router = Router();
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response, _next, options) {
      response.status(options.statusCode).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
          requestId: request.id,
        },
      });
    },
  });

  router.post('/register', authLimiter, asyncHandler(async (request, response) => {
    const input = registerSchema.parse(request.body);
    const session = await authService.register(input);
    setSessionCookies(response, config, session);
    response.status(201).json({ user: userResponse(session.user) });
  }));

  router.post('/login', authLimiter, asyncHandler(async (request, response) => {
    const input = loginSchema.parse(request.body);
    const session = await authService.login(input);
    setSessionCookies(response, config, session);
    response.json({ user: userResponse(session.user) });
  }));

  router.get('/me', auth.requireAuth, (request, response) => {
    response.json({ user: userResponse(request.auth.user) });
  });

  router.post('/logout', auth.requireAuth, auth.requireCsrf, asyncHandler(async (request, response) => {
    await authService.logout(request.auth.sessionToken);
    clearSessionCookies(response, config);
    response.status(204).end();
  }));

  return router;
}
