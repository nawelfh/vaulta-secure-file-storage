import { describe, expect, it } from 'vitest';
import { formatBytes } from './format.js';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1024, '1.0 KB'],
    [10 * 1024 * 1024, '10 MB'],
    [1.5 * 1024 * 1024 * 1024, '1.5 GB'],
  ])('formats %s bytes', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});
