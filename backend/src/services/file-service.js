import { randomUUID } from 'node:crypto';
import { ApiError } from '../utils/api-error.js';
import { randomToken } from '../utils/crypto.js';
import {
  expectedPartCount,
  matchesDeclaredType,
  validateFileMetadata,
} from '../utils/file-validation.js';

function requireFile(file) {
  if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', 'File not found.');
  return file;
}

function publicFile(file, appOrigin) {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    status: file.status,
    visibility: file.visibility,
    rejectionReason: file.rejectionReason,
    shareUrl: file.shareToken ? `${appOrigin}/share/${file.shareToken}` : null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function createFileService({ files, storage, config }) {
  async function validateCompletedObject(file) {
    const metadata = await storage.head(file.storageKey);
    if (!metadata || metadata.sizeBytes !== file.sizeBytes) {
      await storage.delete(file.storageKey);
      await files.markRejected({ id: file.id, ownerId: file.ownerId, reason: 'SIZE_MISMATCH' });
      throw new ApiError(422, 'FILE_SIZE_MISMATCH', 'The uploaded object size does not match the request.');
    }

    const prefix = await storage.readPrefix(file.storageKey);
    if (!matchesDeclaredType(file.mimeType, prefix)) {
      await storage.delete(file.storageKey);
      await files.markRejected({ id: file.id, ownerId: file.ownerId, reason: 'CONTENT_TYPE_MISMATCH' });
      throw new ApiError(422, 'FILE_CONTENT_MISMATCH', 'The file contents do not match its declared type.');
    }
  }

  return {
    serialize: (file) => publicFile(file, config.appOrigin),

    async startUpload({ ownerId, metadata }) {
      const validated = validateFileMetadata(metadata, config.maxFileSizeBytes);
      const id = randomUUID();
      const storageKey = `${ownerId}/${id}/${randomToken(16)}`;
      const uploadId = await storage.createMultipart({ key: storageKey, mimeType: validated.mimeType });

      try {
        const file = await files.createUpload({
          id,
          ownerId,
          storageKey,
          multipartUploadId: uploadId,
          ...validated,
        });
        return {
          file: publicFile(file, config.appOrigin),
          partSizeBytes: storage.partSizeBytes,
          partCount: expectedPartCount(file.sizeBytes, storage.partSizeBytes),
        };
      } catch (error) {
        await storage.abortMultipart({ key: storageKey, uploadId }).catch(() => {});
        throw error;
      }
    },

    async signParts({ ownerId, fileId, partNumbers }) {
      const file = requireFile(await files.findOwned(fileId, ownerId));
      if (file.status !== 'UPLOADING' || !file.multipartUploadId) {
        throw new ApiError(409, 'UPLOAD_NOT_ACTIVE', 'This upload is no longer active.');
      }

      const count = expectedPartCount(file.sizeBytes, storage.partSizeBytes);
      const unique = [...new Set(partNumbers)].sort((a, b) => a - b);
      if (unique.length !== partNumbers.length || unique.some((number) => number < 1 || number > count)) {
        throw new ApiError(422, 'INVALID_PART_NUMBERS', 'Part numbers must be unique and within the upload range.');
      }

      return Promise.all(unique.map(async (partNumber) => ({
        partNumber,
        url: await storage.signPart({
          key: file.storageKey,
          uploadId: file.multipartUploadId,
          partNumber,
        }),
      })));
    },

    async completeUpload({ ownerId, fileId, parts }) {
      let file = requireFile(await files.findOwned(fileId, ownerId));
      if (file.status === 'READY') return publicFile(file, config.appOrigin);
      if (file.status !== 'UPLOADING' || !file.multipartUploadId) {
        throw new ApiError(409, 'UPLOAD_NOT_ACTIVE', 'This upload is no longer active.');
      }

      const expectedCount = expectedPartCount(file.sizeBytes, storage.partSizeBytes);
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const validSequence = ordered.length === expectedCount
        && ordered.every((part, index) => part.partNumber === index + 1);
      if (!validSequence) {
        throw new ApiError(422, 'INCOMPLETE_PART_LIST', 'Every upload part must be supplied exactly once.');
      }

      const existingObject = await storage.head(file.storageKey);
      if (!existingObject) {
        await storage.completeMultipart({
          key: file.storageKey,
          uploadId: file.multipartUploadId,
          parts: ordered,
        });
      }

      await validateCompletedObject(file);
      file = await files.markReady({ id: file.id, ownerId });
      if (!file) {
        file = requireFile(await files.findOwned(fileId, ownerId));
      }
      return publicFile(file, config.appOrigin);
    },

    async list({ ownerId, cursor, limit }) {
      const result = await files.listOwned({ ownerId, cursor, limit });
      return {
        items: result.items
          .filter((file) => file.status === 'READY')
          .map((file) => publicFile(file, config.appOrigin)),
        nextCursor: result.nextCursor,
      };
    },

    async setVisibility({ ownerId, fileId, visibility }) {
      const current = requireFile(await files.findOwned(fileId, ownerId));
      if (current.status !== 'READY') {
        throw new ApiError(409, 'FILE_NOT_READY', 'Only completed files can be shared.');
      }
      const shareToken = visibility === 'PUBLIC' ? (current.shareToken || randomToken()) : null;
      const file = requireFile(await files.updateVisibility({ id: fileId, ownerId, visibility, shareToken }));
      return publicFile(file, config.appOrigin);
    },

    async getOwnerDownload({ ownerId, fileId }) {
      const file = requireFile(await files.findOwned(fileId, ownerId));
      if (file.status !== 'READY') throw new ApiError(409, 'FILE_NOT_READY', 'The file is not ready to download.');
      return {
        url: await storage.signDownload({
          key: file.storageKey,
          fileName: file.originalName,
          mimeType: file.mimeType,
        }),
        expiresIn: storage.signedUrlTtlSeconds,
      };
    },

    async getPublicDownload(shareToken) {
      const file = requireFile(await files.findPublic(shareToken));
      return storage.signDownload({
        key: file.storageKey,
        fileName: file.originalName,
        mimeType: file.mimeType,
      });
    },

    async delete({ ownerId, fileId }) {
      const file = requireFile(await files.findOwned(fileId, ownerId));
      if (file.status === 'UPLOADING' && file.multipartUploadId) {
        await storage.abortMultipart({
          key: file.storageKey,
          uploadId: file.multipartUploadId,
        }).catch((error) => {
          if (error.name !== 'NoSuchUpload') throw error;
        });
      } else if (file.status === 'READY') {
        await storage.delete(file.storageKey);
      }
      await files.deleteOwned(fileId, ownerId);
    },
  };
}
