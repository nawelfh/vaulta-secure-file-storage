import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/utils/api-error.js';
import {
  expectedPartCount,
  matchesDeclaredType,
  validateFileMetadata,
} from '../src/utils/file-validation.js';

const MAX_SIZE = 250 * 1024 * 1024;

function isoBox(type, payload, declaredSize = 8 + payload.length) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(declaredSize, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function ftyp(majorBrand, compatibleBrands = []) {
  const minorVersion = Buffer.alloc(4);
  const brands = compatibleBrands.map((brand) => Buffer.from(brand, 'ascii'));
  return isoBox('ftyp', Buffer.concat([Buffer.from(majorBrand, 'ascii'), minorVersion, ...brands]));
}

function extendedFtyp(majorBrand, compatibleBrands = [], declaredSize) {
  const minorVersion = Buffer.alloc(4);
  const brands = compatibleBrands.map((brand) => Buffer.from(brand, 'ascii'));
  const payload = Buffer.concat([Buffer.from(majorBrand, 'ascii'), minorVersion, ...brands]);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write('ftyp', 4, 4, 'ascii');
  header.writeBigUInt64BE(declaredSize ?? BigInt(header.length + payload.length), 8);
  return Buffer.concat([header, payload]);
}

function ebmlElement(idHex, value) {
  if (value.length > 126) throw new Error('Test EBML value is too large.');
  return Buffer.concat([Buffer.from(idHex, 'hex'), Buffer.from([0x80 | value.length]), value]);
}

function webmHeader(docType = 'webm') {
  const payload = Buffer.concat([
    ebmlElement('4286', Buffer.from([1])),
    ebmlElement('42f7', Buffer.from([1])),
    ebmlElement('42f2', Buffer.from([4])),
    ebmlElement('42f3', Buffer.from([8])),
    ebmlElement('4282', Buffer.from(docType, 'ascii')),
  ]);
  return Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from([0x80 | payload.length]), payload]);
}

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
    ['document.pdf', 'application/pdf'],
    ['picture.png', 'image/png'],
    ['picture.jpg', 'image/jpeg'],
    ['picture.jpeg', 'image/jpeg'],
    ['notes.txt', 'text/plain'],
    ['bundle.zip', 'application/zip'],
    ['animation.gif', 'image/gif'],
    ['picture.webp', 'image/webp'],
    ['movie.mp4', 'video/mp4'],
    ['movie.webm', 'video/webm'],
    ['movie.mov', 'video/quicktime'],
  ])('accepts supported media metadata: %s', (originalName, mimeType) => {
    expect(validateFileMetadata({ originalName, mimeType, sizeBytes: 1024 }, MAX_SIZE))
      .toEqual({ originalName, mimeType, sizeBytes: 1024 });
  });

  it.each([
    ['animation.gif', 'image/png'],
    ['animation.png', 'image/gif'],
    ['picture.webp', 'image/jpeg'],
    ['picture.jpg', 'image/webp'],
    ['movie.mp4', 'video/webm'],
    ['movie.mp4', 'application/octet-stream'],
    ['movie.webm', 'video/mp4'],
    ['movie.mov', 'video/mp4'],
    ['movie.mp4', 'video/quicktime'],
  ])('rejects media extension and MIME mismatches: %s as %s', (originalName, mimeType) => {
    expect(() => validateFileMetadata({ originalName, mimeType, sizeBytes: 1024 }, MAX_SIZE))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_FILE_TYPE' }));
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

  describe('GIF content validation', () => {
    it('accepts both standard GIF signatures', () => {
      expect(matchesDeclaredType('image/gif', Buffer.from('GIF87a content'))).toBe(true);
      expect(matchesDeclaredType('image/gif', Buffer.from('GIF89a content'))).toBe(true);
    });

    it.each([
      Buffer.from('NOTGIF content'),
      Buffer.from('GIF8'),
      Buffer.from('GIF90a'),
    ])('rejects fake or truncated GIF content', (content) => {
      expect(matchesDeclaredType('image/gif', content)).toBe(false);
    });
  });

  describe('WebP content validation', () => {
    it('accepts a RIFF container whose format is WEBP', () => {
      const content = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
      expect(matchesDeclaredType('image/webp', content)).toBe(true);
    });

    it.each([
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]),
      Buffer.concat([Buffer.from('NOPE'), Buffer.alloc(4), Buffer.from('WEBP')]),
      Buffer.from('RIFFshort'),
    ])('rejects non-WebP or truncated RIFF content', (content) => {
      expect(matchesDeclaredType('image/webp', content)).toBe(false);
    });
  });

  describe('MP4 content validation', () => {
    it('accepts a normal MP4 ftyp box', () => {
      expect(matchesDeclaredType('video/mp4', ftyp('isom', ['mp42']))).toBe(true);
    });

    it('accepts a valid alternate brand and an ftyp after another complete box', () => {
      const content = Buffer.concat([isoBox('free', Buffer.alloc(8)), ftyp('iso6', ['dash'])]);
      expect(matchesDeclaredType('video/mp4', content)).toBe(true);
      expect(matchesDeclaredType('video/mp4', extendedFtyp('mp42', ['isom']))).toBe(true);
    });

    it.each([
      Buffer.from('arbitrary video bytes'),
      isoBox('ftyp', Buffer.from('notmp4!!')),
      isoBox('ftyp', Buffer.alloc(4), 4),
      isoBox('ftyp', Buffer.alloc(4), 24),
      Buffer.from('0000000166747970', 'hex'),
      Buffer.from('000000006674797069736f6d00000000', 'hex'),
      isoBox('free', Buffer.from('000000106674797069736f6d00000000', 'hex')),
      extendedFtyp('isom', [], 12n),
      extendedFtyp('isom', [], BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ])('rejects fake, malformed, or truncated MP4 content', (content) => {
      expect(matchesDeclaredType('video/mp4', content)).toBe(false);
    });
  });

  describe('WebM content validation', () => {
    it('accepts a bounded EBML header with the WebM DocType', () => {
      expect(matchesDeclaredType('video/webm', webmHeader())).toBe(true);
    });

    it.each([
      webmHeader('matroska'),
      Buffer.from('1a45dfa3ff', 'hex'),
      Buffer.from('1a45df', 'hex'),
      Buffer.concat([Buffer.from('1a45dfa381', 'hex'), Buffer.from([0])]),
      Buffer.concat([Buffer.from('1a45dfa380', 'hex'), ebmlElement('4282', Buffer.from('webm'))]),
    ])('rejects non-WebM, malformed, incorrect, or truncated EBML content', (content) => {
      expect(matchesDeclaredType('video/webm', content)).toBe(false);
    });
  });

  describe('MOV content validation', () => {
    it('accepts a structurally valid QuickTime-branded ftyp box', () => {
      expect(matchesDeclaredType('video/quicktime', ftyp('qt  '))).toBe(true);
    });

    it('rejects MP4-branded, malformed, and truncated content as QuickTime', () => {
      expect(matchesDeclaredType('video/quicktime', ftyp('isom', ['mp42']))).toBe(false);
      expect(matchesDeclaredType('video/quicktime', isoBox('ftyp', Buffer.alloc(4), 4))).toBe(false);
      expect(matchesDeclaredType('video/quicktime', Buffer.from('quicktime'))).toBe(false);
    });
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
