import { describe, expect, it } from 'vitest';
import { formatBytes } from './format.js';

describe('formatBytes', () => {
  it.each([
    [0, '0 MB'],
    [1, '<0.01 MB'],
    [156, '<0.01 MB'],
    [Math.round(3.7 * 1024), '<0.01 MB'],
    [54 * 1024, '0.05 MB'],
    [1024 * 1024, '1 MB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
    [10 * 1024 * 1024, '10 MB'],
    [156 * 1024 * 1024, '156 MB'],
    [1024 * 1024 * 1024, '1 GB'],
    [1.5 * 1024 * 1024 * 1024, '1.5 GB'],
  ])('formats %s bytes', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});
