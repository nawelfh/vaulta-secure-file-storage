import { ACCOUNT_STORAGE_QUOTA_BYTES } from '../config/storage.js';

function safeDatabaseInteger(value, field, { nullAsZero = false } = {}) {
  if (value === null || value === undefined) {
    if (nullAsZero) return 0;
    throw new Error(`Missing ${field} aggregate from the database.`);
  }
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid ${field} aggregate returned by the database.`);
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} aggregate is outside JavaScript's safe integer range.`);
  }
  return Number(parsed);
}

export function createStorageStatsService({ files, quotaBytes = ACCOUNT_STORAGE_QUOTA_BYTES }) {
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
    throw new Error('Storage quota must be a positive safe integer.');
  }

  return {
    async getForOwner(ownerId) {
      const aggregate = await files.getReadyStorageStats(ownerId);
      const totalFiles = safeDatabaseInteger(aggregate?.totalFiles, 'totalFiles');
      const publicFiles = safeDatabaseInteger(aggregate?.publicFiles, 'publicFiles');
      const privateFiles = safeDatabaseInteger(aggregate?.privateFiles, 'privateFiles');
      const usedBytes = safeDatabaseInteger(aggregate?.usedBytes, 'usedBytes', { nullAsZero: true });

      if (publicFiles + privateFiles !== totalFiles) {
        throw new Error('READY file visibility aggregates are inconsistent.');
      }

      const remainingBytes = Math.max(quotaBytes - usedBytes, 0);
      const percentageUsed = Math.min(
        Math.round((usedBytes / quotaBytes) * 10_000) / 100,
        100,
      );

      return {
        totalFiles,
        publicFiles,
        privateFiles,
        usedBytes,
        quotaBytes,
        remainingBytes,
        percentageUsed,
      };
    },
  };
}
