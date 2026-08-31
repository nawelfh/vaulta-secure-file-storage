import { describe, expect, it } from 'vitest';
import { formatFileSize, formatStorageSize } from './format.js';

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [156, '156 B'],
    [Math.round(3.7 * 1024), '3.7 KB'],
    [54 * 1024, '54 KB'],
    [850 * 1024, '850 KB'],
    [1024 * 1024, '1 MB'],
    [2.4 * 1024 * 1024, '2.4 MB'],
    [850 * 1024 * 1024, '850 MB'],
    [1024 * 1024 * 1024, '1 GB'],
    [1.2 * 1024 * 1024 * 1024, '1.2 GB'],
  ])('formats %s bytes', (input, expected) => {
    expect(formatFileSize(input)).toBe(expected);
  });
});

describe('formatStorageSize', () => {
  it.each([
    [0, '0 MB'],
    [156, '<0.01 MB'],
    [Math.round(3.7 * 1024), '<0.01 MB'],
    [54 * 1024, '0.05 MB'],
    [850 * 1024, '0.83 MB'],
    [5 * 1024 * 1024, '5 MB'],
    [245 * 1024 * 1024, '245 MB'],
    [1024 * 1024 * 1024, '1 GB'],
  ])('formats %s aggregate bytes', (input, expected) => {
    expect(formatStorageSize(input)).toBe(expected);
  });
});
