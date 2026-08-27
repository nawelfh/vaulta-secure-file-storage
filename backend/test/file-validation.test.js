import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/utils/api-error.js';
import {
  expectedPartCount,
  matchesDeclaredType,
  validateFileMetadata,
} from '../src/utils/file-validation.js';

const MAX_SIZE = 250 * 1024 * 1024;

describe('file metadata validation', () => {
  it('accepts a 100 MB PDF upload', () => {
    expect(validateFileMetadata({
      originalName: 'annual-report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100 * 1024 * 1024,
    }, MAX_SIZE)).toEqual({
      originalName: 'annual-report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100 * 1024 * 1024,
    });
  });

  it.each([
    ['../secret.pdf', 'application/pdf', 100, 'INVALID_FILE_NAME'],
    ['photo.pdf', 'image/jpeg', 100, 'UNSUPPORTED_FILE_TYPE'],
    ['script.html', 'text/html', 100, 'UNSUPPORTED_FILE_TYPE'],
    ['empty.txt', 'text/plain', 0, 'INVALID_FILE_SIZE'],
    ['large.zip', 'application/zip', MAX_SIZE + 1, 'INVALID_FILE_SIZE'],
  ])('rejects unsafe metadata: %s', (originalName, mimeType, sizeBytes, code) => {
    expect(() => validateFileMetadata({ originalName, mimeType, sizeBytes }, MAX_SIZE))
      .toThrowError(expect.objectContaining({ code }));
  });

  it('checks magic bytes independently of the declared MIME type', () => {
    expect(matchesDeclaredType('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(matchesDeclaredType('image/png', Buffer.from('89504e470d0a1a0a', 'hex'))).toBe(true);
    expect(matchesDeclaredType('image/jpeg', Buffer.from('ffd8ffe0', 'hex'))).toBe(true);
    expect(matchesDeclaredType('application/zip', Buffer.from('504b0304', 'hex'))).toBe(true);
    expect(matchesDeclaredType('application/pdf', Buffer.from('<script>'))).toBe(false);
    expect(matchesDeclaredType('text/plain', Buffer.from([65, 0, 66]))).toBe(false);
  });

  it('calculates multipart boundaries', () => {
    expect(expectedPartCount(10, 10)).toBe(1);
    expect(expectedPartCount(11, 10)).toBe(2);
  });

  it('uses structured API errors', () => {
    try {
      validateFileMetadata({ originalName: '', mimeType: 'text/plain', sizeBytes: 1 }, MAX_SIZE);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(422);
    }
  });
});
