import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const envPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.env',
);

dotenv.config({ path: envPath, quiet: true });

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: booleanFromString.default(false),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  COOKIE_NAME: z.string().min(1).default('secure_store_session'),
  CSRF_COOKIE_NAME: z.string().min(1).default('secure_store_csrf'),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().min(104_857_600).max(5_368_709_120).default(262_144_000),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: booleanFromString.default(false),
  S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  S3_PART_SIZE_BYTES: z.coerce.number().int().min(5_242_880).max(104_857_600).default(10_485_760),
  S3_SSE: z.enum(['AES256', 'aws:kms']).optional(),
});

export function loadConfig(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const env = result.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appOrigin: env.APP_ORIGIN.replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    cookieName: env.COOKIE_NAME,
    csrfCookieName: env.CSRF_COOKIE_NAME,
    maxFileSizeBytes: env.MAX_FILE_SIZE_BYTES,
    s3: {
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      signedUrlTtlSeconds: env.S3_SIGNED_URL_TTL_SECONDS,
      partSizeBytes: env.S3_PART_SIZE_BYTES,
      serverSideEncryption: env.S3_SSE,
    },
    isProduction: env.NODE_ENV === 'production',
  };
}
