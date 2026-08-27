import path from 'node:path';
import { ApiError } from './api-error.js';

const allowedTypes = new Map([
  ['application/pdf', new Set(['.pdf'])],
  ['image/png', new Set(['.png'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['text/plain', new Set(['.txt'])],
  ['application/zip', new Set(['.zip'])],
]);

const signatures = {
  'application/pdf': [Buffer.from('%PDF-')],
  'image/png': [Buffer.from('89504e470d0a1a0a', 'hex')],
  'image/jpeg': [Buffer.from('ffd8ff', 'hex')],
  'application/zip': [
    Buffer.from('504b0304', 'hex'),
    Buffer.from('504b0506', 'hex'),
    Buffer.from('504b0708', 'hex'),
  ],
};

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
      'Allowed file types are PDF, PNG, JPEG, TXT, and ZIP.',
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
  if (mimeType === 'text/plain') return !prefix.includes(0);
  return signatures[mimeType]?.some((signature) => prefix.subarray(0, signature.length).equals(signature)) ?? false;
}

export function expectedPartCount(sizeBytes, partSizeBytes) {
  return Math.ceil(sizeBytes / partSizeBytes);
}
