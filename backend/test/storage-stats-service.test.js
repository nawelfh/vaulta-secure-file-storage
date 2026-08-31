import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_STORAGE_QUOTA_BYTES } from '../src/config/storage.js';
import { createStorageStatsService } from '../src/services/storage-stats-service.js';

function harness(aggregate, quotaBytes = ACCOUNT_STORAGE_QUOTA_BYTES) {
  const files = {
    getReadyStorageStats: vi.fn(async () => aggregate),
  };
  return {
    files,
    service: createStorageStatsService({ files, quotaBytes }),
  };
}

describe('authoritative storage statistics', () => {
  it('uses the assessment-wide one GiB quota exactly', () => {
    expect(ACCOUNT_STORAGE_QUOTA_BYTES).toBe(1_073_741_824);
  });

  it('normalizes an empty account and null SUM to zero', async () => {
    const { service } = harness({
      totalFiles: '0', publicFiles: '0', privateFiles: '0', usedBytes: null,
    });

    await expect(service.getForOwner('user-a')).resolves.toEqual({
      totalFiles: 0,
      publicFiles: 0,
      privateFiles: 0,
      usedBytes: 0,
      quotaBytes: 1_073_741_824,
      remainingBytes: 1_073_741_824,
      percentageUsed: 0,
    });
  });

  it('reports one private READY file', async () => {
    const { service } = harness({
      totalFiles: '1', publicFiles: '0', privateFiles: '1', usedBytes: '1024',
    });
    await expect(service.getForOwner('user-a')).resolves.toMatchObject({
      totalFiles: 1, publicFiles: 0, privateFiles: 1, usedBytes: 1024,
    });
  });

  it('reports one public READY file', async () => {
    const { service } = harness({
      totalFiles: '1', publicFiles: '1', privateFiles: '0', usedBytes: '2048',
    });
    await expect(service.getForOwner('user-a')).resolves.toMatchObject({
      totalFiles: 1, publicFiles: 1, privateFiles: 0, usedBytes: 2048,
    });
  });

  it('reports mixed visibility and summed bytes without pagination input', async () => {
    const { files, service } = harness({
      totalFiles: '300', publicFiles: '125', privateFiles: '175', usedBytes: '786432000',
    });
    const stats = await service.getForOwner('owner-300');

    expect(stats).toMatchObject({
      totalFiles: 300,
      publicFiles: 125,
      privateFiles: 175,
      usedBytes: 786_432_000,
    });
    expect(files.getReadyStorageStats).toHaveBeenCalledWith('owner-300');
    expect(files.getReadyStorageStats).toHaveBeenCalledTimes(1);
  });

  it('accepts active counts with used bytes that still include Trash storage', async () => {
    const { service } = harness({
      totalFiles: '2', publicFiles: '1', privateFiles: '1', usedBytes: '6144',
    });
    await expect(service.getForOwner('owner-with-trash')).resolves.toMatchObject({
      totalFiles: 2, publicFiles: 1, privateFiles: 1, usedBytes: 6144,
    });
  });

  it('calculates remaining bytes and a two-decimal percentage', async () => {
    const { service } = harness({
      totalFiles: '2', publicFiles: '1', privateFiles: '1', usedBytes: '256901120',
    });
    await expect(service.getForOwner('user-a')).resolves.toMatchObject({
      remainingBytes: 816_840_704,
      percentageUsed: 23.93,
    });
  });

  it('reports exactly full usage at the quota boundary', async () => {
    const { service } = harness({
      totalFiles: '2', publicFiles: '1', privateFiles: '1', usedBytes: '1073741824',
    });
    await expect(service.getForOwner('user-a')).resolves.toMatchObject({
      usedBytes: 1_073_741_824,
      remainingBytes: 0,
      percentageUsed: 100,
    });
  });

  it('clamps remaining bytes and percentage when READY usage exceeds quota', async () => {
    const { service } = harness({
      totalFiles: '3', publicFiles: '1', privateFiles: '2', usedBytes: '2147483648',
    });
    await expect(service.getForOwner('user-a')).resolves.toMatchObject({
      usedBytes: 2_147_483_648,
      remainingBytes: 0,
      percentageUsed: 100,
    });
  });

  it('converts PostgreSQL bigint strings without concatenation', async () => {
    const { service } = harness({
      totalFiles: '9000', publicFiles: '4000', privateFiles: '5000', usedBytes: '9007199254740991',
    });
    await expect(service.getForOwner('user-a')).resolves.toMatchObject({
      totalFiles: 9000,
      publicFiles: 4000,
      privateFiles: 5000,
      usedBytes: Number.MAX_SAFE_INTEGER,
      remainingBytes: 0,
      percentageUsed: 100,
    });
  });

  it.each([
    ['not-an-integer'],
    ['9007199254740992'],
    ['-1'],
  ])('fails closed for an unsafe database byte aggregate: %s', async (usedBytes) => {
    const { service } = harness({
      totalFiles: '1', publicFiles: '0', privateFiles: '1', usedBytes,
    });
    await expect(service.getForOwner('user-a')).rejects.toThrow(/usedBytes aggregate/);
  });

  it('fails closed rather than silently classifying inconsistent visibility totals', async () => {
    const { service } = harness({
      totalFiles: '3', publicFiles: '1', privateFiles: '1', usedBytes: '100',
    });
    await expect(service.getForOwner('user-a')).rejects.toThrow(/visibility aggregates are inconsistent/);
  });

  it('fails closed when a required count aggregate is missing', async () => {
    const { service } = harness({
      publicFiles: '0', privateFiles: '0', usedBytes: '0',
    });
    await expect(service.getForOwner('user-a')).rejects.toThrow(/Missing totalFiles aggregate/);
  });

  it('rejects an invalid configured quota', () => {
    expect(() => harness({ totalFiles: '0' }, 0)).toThrow(/positive safe integer/);
  });
});
