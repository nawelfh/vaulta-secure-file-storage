import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function createPublicRouter({ fileService }) {
  const router = Router();
  const downloadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response, _next, options) {
      response.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many download requests.', requestId: request.id },
      });
    },
  });

  router.get('/:shareToken', downloadLimiter, asyncHandler(async (request, response) => {
    const shareToken = tokenSchema.parse(request.params.shareToken);
    const url = await fileService.getPublicDownload(shareToken);
    response.redirect(302, url);
  }));

  return router;
}
