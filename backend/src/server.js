import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { createRepositories } from './db/repositories.js';
import { createAuthService } from './services/auth-service.js';
import { createFileService } from './services/file-service.js';
import { createS3Storage } from './storage/s3-storage.js';

const config = loadConfig();
const logger = pino({ level: config.isProduction ? 'info' : 'debug' });
const pool = createPool(config);
const repositories = createRepositories(pool);
const storage = createS3Storage(config.s3);
const authService = createAuthService({
  ...repositories,
  sessionTtlHours: config.sessionTtlHours,
});
const fileService = createFileService({ files: repositories.files, storage, config });
const app = createApp({ config, authService, fileService, pool, logger });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Secure file storage API started');
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
