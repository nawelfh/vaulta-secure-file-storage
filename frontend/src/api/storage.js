import { ApiClientError, apiFetch } from './client.js';

const INTEGER_FIELDS = ['totalFiles', 'publicFiles', 'privateFiles', 'usedBytes', 'quotaBytes', 'remainingBytes'];

function isValidStats(stats) {
  return stats
    && INTEGER_FIELDS.every((field) => Number.isSafeInteger(stats[field]) && stats[field] >= 0)
    && stats.quotaBytes > 0
    && stats.remainingBytes <= stats.quotaBytes
    && typeof stats.percentageUsed === 'number'
    && Number.isFinite(stats.percentageUsed)
    && stats.percentageUsed >= 0
    && stats.percentageUsed <= 100
    && stats.publicFiles + stats.privateFiles === stats.totalFiles;
}

export async function getStorageStats(options = {}) {
  const result = await apiFetch('/api/storage/stats', options);
  if (!isValidStats(result?.stats)) {
    throw new ApiClientError(
      'Vaulta received an invalid storage statistics response.',
      502,
      'INVALID_STORAGE_STATS_RESPONSE',
    );
  }
  return result.stats;
}
