import path from 'node:path';
import { ApiError } from './api-error.js';

const allowedTypes = new Map([
  ['application/pdf', new Set(['.pdf'])],
  ['image/png', new Set(['.png'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/gif', new Set(['.gif'])],
  ['image/webp', new Set(['.webp'])],
  ['video/mp4', new Set(['.mp4'])],
  ['video/webm', new Set(['.webm'])],
  ['video/quicktime', new Set(['.mov'])],
  ['text/plain', new Set(['.txt'])],
  ['application/zip', new Set(['.zip'])],
]);

const signatures = {
  'application/pdf': [Buffer.from('%PDF-')],
  'image/png': [Buffer.from('89504e470d0a1a0a', 'hex')],
  'image/jpeg': [Buffer.from('ffd8ff', 'hex')],
  'image/gif': [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  'application/zip': [
    Buffer.from('504b0304', 'hex'),
    Buffer.from('504b0506', 'hex'),
    Buffer.from('504b0708', 'hex'),
  ],
};

export const FILE_SIGNATURE_PREFIX_BYTES = 4096;

const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'mp71', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'F4V ', 'MSNV',
  'dash', 'cmfc', 'cmfs',
]);
const QUICKTIME_BRAND = 'qt  ';

function isoBmffBrands(prefix) {
  let offset = 0;
  while (offset + 8 <= prefix.length) {
    const size32 = prefix.readUInt32BE(offset);
    const type = prefix.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 0) return null;
    if (size32 === 1) {
      if (offset + 16 > prefix.length) return null;
      const extendedSize = prefix.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      headerSize = 16;
      boxSize = Number(extendedSize);
    }
    if (boxSize < headerSize || offset + boxSize > prefix.length) return null;

    if (type === 'ftyp') {
      const payloadSize = boxSize - headerSize;
      if (payloadSize < 8 || (payloadSize - 8) % 4 !== 0) return null;
      const payloadOffset = offset + headerSize;
      const brands = [prefix.toString('ascii', payloadOffset, payloadOffset + 4)];
      for (let brandOffset = payloadOffset + 8; brandOffset < offset + boxSize; brandOffset += 4) {
        brands.push(prefix.toString('ascii', brandOffset, brandOffset + 4));
      }
      return brands;
    }

    offset += boxSize;
  }
  return null;
}

function isWebp(prefix) {
  return prefix.length >= 12
    && prefix.subarray(0, 4).equals(Buffer.from('RIFF'))
    && prefix.subarray(8, 12).equals(Buffer.from('WEBP'));
}

function variableIntegerLength(firstByte, maximumLength) {
  if (firstByte === 0) return 0;
  let mask = 0x80;
  for (let length = 1; length <= maximumLength; length += 1) {
    if (firstByte & mask) return length;
    mask >>= 1;
  }
  return 0;
}

function readEbmlId(buffer, offset, end) {
  if (offset >= end) return null;
  const length = variableIntegerLength(buffer[offset], 4);
  if (!length || offset + length > end) return null;
  return { bytes: buffer.subarray(offset, offset + length), length };
}

function readEbmlSize(buffer, offset, end) {
  if (offset >= end) return null;
  const length = variableIntegerLength(buffer[offset], 8);
  if (!length || offset + length > end) return null;
  const markerMask = 0x80 >> (length - 1);
  let value = BigInt(buffer[offset] & (markerMask - 1));
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) | BigInt(buffer[offset + index]);
  }
  const unknownValue = (1n << BigInt(7 * length)) - 1n;
  if (value === unknownValue || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { value: Number(value), length };
}

function isWebm(prefix) {
  const ebmlSignature = Buffer.from('1a45dfa3', 'hex');
  if (prefix.length < 5 || !prefix.subarray(0, 4).equals(ebmlSignature)) return false;

  const headerSize = readEbmlSize(prefix, 4, prefix.length);
  if (!headerSize) return false;
  const headerStart = 4 + headerSize.length;
  const headerEnd = headerStart + headerSize.value;
  if (headerEnd > prefix.length) return false;

  let offset = headerStart;
  while (offset < headerEnd) {
    const id = readEbmlId(prefix, offset, headerEnd);
    if (!id) return false;
    const size = readEbmlSize(prefix, offset + id.length, headerEnd);
    if (!size) return false;
    const valueStart = offset + id.length + size.length;
    const valueEnd = valueStart + size.value;
    if (valueEnd > headerEnd) return false;
    if (id.bytes.equals(Buffer.from('4282', 'hex'))) {
      return size.value === 4 && prefix.toString('ascii', valueStart, valueEnd) === 'webm';
    }
    offset = valueEnd;
  }
  return false;
}

export function validateFileMetadata({ originalName, mimeType, sizeBytes }, maxSizeBytes) {
  if (typeof originalName !== 'string' || originalName.length === 0 || originalName.length > 255) {
    throw new ApiError(422, 'INVALID_FILE_NAME', 'The file name must contain 1 to 255 characters.');
  }

  const normalizedName = originalName.normalize('NFC');
  if (
    normalizedName !== path.basename(normalizedName)
    || normalizedName.includes('\\')
    || [...normalizedName].some((character) => {
      const code = character.codePointAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new ApiError(422, 'INVALID_FILE_NAME', 'The file name contains unsafe characters.');
  }

  const extensions = allowedTypes.get(mimeType);
  const extension = path.extname(normalizedName).toLowerCase();
  if (!extensions?.has(extension)) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE_TYPE',
      'Allowed file types are PDF, PNG, JPEG, GIF, WebP, MP4, WebM, MOV, TXT, and ZIP.',
    );
  }

  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxSizeBytes) {
    throw new ApiError(
      413,
      'INVALID_FILE_SIZE',
      `The file must be between 1 byte and ${maxSizeBytes} bytes.`,
    );
  }

  return { originalName: normalizedName, mimeType, sizeBytes };
}

export function matchesDeclaredType(mimeType, prefix) {
  if (mimeType === 'text/plain') return !prefix.subarray(0, 16).includes(0);
  if (mimeType === 'image/webp') return isWebp(prefix);
  if (mimeType === 'video/webm') return isWebm(prefix);
  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
    const brands = isoBmffBrands(prefix);
    if (!brands) return false;
    return mimeType === 'video/mp4'
      ? brands.some((brand) => MP4_BRANDS.has(brand))
      : brands.includes(QUICKTIME_BRAND);
  }
  return signatures[mimeType]?.some((signature) => prefix.subarray(0, signature.length).equals(signature)) ?? false;
}

export function expectedPartCount(sizeBytes, partSizeBytes) {
  return Math.ceil(sizeBytes / partSizeBytes);
}
