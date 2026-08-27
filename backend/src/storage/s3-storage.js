import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function contentDisposition(fileName) {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createS3Storage(config) {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const common = { Bucket: config.bucket };

  return {
    async createMultipart({ key, mimeType }) {
      const result = await client.send(new CreateMultipartUploadCommand({
        ...common,
        Key: key,
        ContentType: mimeType,
        ...(config.serverSideEncryption && { ServerSideEncryption: config.serverSideEncryption }),
      }));
      if (!result.UploadId) throw new Error('The storage provider did not return an upload ID.');
      return result.UploadId;
    },

    async signPart({ key, uploadId, partNumber }) {
      return getSignedUrl(
        client,
        new UploadPartCommand({ ...common, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: config.signedUrlTtlSeconds },
      );
    },

    async completeMultipart({ key, uploadId, parts }) {
      await client.send(new CompleteMultipartUploadCommand({
        ...common,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map(({ partNumber, etag }) => ({ PartNumber: partNumber, ETag: etag })),
        },
      }));
    },

    async abortMultipart({ key, uploadId }) {
      await client.send(new AbortMultipartUploadCommand({
        ...common,
        Key: key,
        UploadId: uploadId,
      }));
    },

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ ...common, Key: key }));
        return { sizeBytes: result.ContentLength, contentType: result.ContentType };
      } catch (error) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },

    async readPrefix(key, byteCount = 16) {
      const result = await client.send(new GetObjectCommand({
        ...common,
        Key: key,
        Range: `bytes=0-${byteCount - 1}`,
      }));
      return Buffer.from(await result.Body.transformToByteArray());
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ ...common, Key: key }));
    },

    async signDownload({ key, fileName, mimeType }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          ...common,
          Key: key,
          ResponseContentType: mimeType,
          ResponseContentDisposition: contentDisposition(fileName),
        }),
        { expiresIn: config.signedUrlTtlSeconds },
      );
    },

    signedUrlTtlSeconds: config.signedUrlTtlSeconds,
    partSizeBytes: config.partSizeBytes,
  };
}
