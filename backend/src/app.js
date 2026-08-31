import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth-routes.js';
import { createFileRouter } from './routes/file-routes.js';
import { createPublicRouter } from './routes/public-routes.js';
import { createStorageRouter } from './routes/storage-routes.js';
import { ApiError } from './utils/api-error.js';

export function createApp({ config, authService, fileService, storageStatsService, pool, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((request, response, next) => {
    request.id = request.get('x-request-id')?.slice(0, 100) || randomUUID();
    response.set('x-request-id', request.id);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (request) => request.id }));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === config.appOrigin) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['x-request-id'],
  }));
  app.use((request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.get('origin');
    if (origin && origin !== config.appOrigin) {
      return next(new ApiError(403, 'UNTRUSTED_ORIGIN', 'The request origin is not allowed.'));
    }
    return next();
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use(cookieParser());
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response, _next, options) {
      response.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: request.id },
      });
    },
  }));

  const auth = createAuthMiddleware({ authService, config });
  app.get('/api/health/live', (request, response) => response.json({ status: 'ok' }));
  app.get('/api/health/ready', async (request, response, next) => {
    try {
      await pool.query('SELECT 1');
      response.json({ status: 'ready' });
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/auth', createAuthRouter({ authService, auth, config }));
  app.use('/api/files', createFileRouter({ fileService, auth }));
  app.use('/api/storage', createStorageRouter({ storageStatsService, auth }));
  app.use('/api/public', createPublicRouter({ fileService }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
