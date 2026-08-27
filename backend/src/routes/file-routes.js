import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.js';

const fileIdSchema = z.string().uuid();
const startUploadSchema = z.object({
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
}).strict();
const partsRequestSchema = z.object({
  partNumbers: z.array(z.number().int()).min(1).max(1000),
}).strict();
const completeSchema = z.object({
  parts: z.array(z.object({
    partNumber: z.number().int().positive(),
    etag: z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/),
  }).strict()).min(1).max(1000),
}).strict();
const visibilitySchema = z.object({
  visibility: z.enum(['PRIVATE', 'PUBLIC']),
}).strict();
const listSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function createFileRouter({ fileService, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/', asyncHandler(async (request, response) => {
    const query = listSchema.parse(request.query);
    const result = await fileService.list({ ownerId: request.auth.user.id, ...query });
    response.json(result);
  }));

  router.post('/uploads', auth.requireCsrf, asyncHandler(async (request, response) => {
    const metadata = startUploadSchema.parse(request.body);
    const result = await fileService.startUpload({ ownerId: request.auth.user.id, metadata });
    response.status(201).json(result);
  }));

  router.post('/:fileId/parts', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const { partNumbers } = partsRequestSchema.parse(request.body);
    const parts = await fileService.signParts({
      ownerId: request.auth.user.id,
      fileId,
      partNumbers,
    });
    response.json({ parts });
  }));

  router.post('/:fileId/complete', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const { parts } = completeSchema.parse(request.body);
    const file = await fileService.completeUpload({
      ownerId: request.auth.user.id,
      fileId,
      parts,
    });
    response.json({ file });
  }));

  router.patch('/:fileId', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const { visibility } = visibilitySchema.parse(request.body);
    const file = await fileService.setVisibility({
      ownerId: request.auth.user.id,
      fileId,
      visibility,
    });
    response.json({ file });
  }));

  router.get('/:fileId/download', asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const result = await fileService.getOwnerDownload({ ownerId: request.auth.user.id, fileId });
    response.json(result);
  }));

  router.delete('/:fileId', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    await fileService.delete({ ownerId: request.auth.user.id, fileId });
    response.status(204).end();
  }));

  return router;
}
