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
const favoriteSchema = z.object({
  favorite: z.boolean(),
}).strict();
const normalSorts = ['newest', 'oldest', 'name-asc', 'name-desc', 'size-asc', 'size-desc'];
const trashSorts = ['deleted-newest', 'deleted-oldest'];
const listSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  page: z.coerce.number().int().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum([...normalSorts, ...trashSorts]).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  view: z.enum(['active', 'recent', 'favorites', 'trash']).optional(),
}).strict().superRefine((query, context) => {
  if (query.cursor && (query.page || query.search !== undefined || query.sort || query.visibility || query.view)) {
    context.addIssue({
      code: 'custom',
      message: 'Cursor pagination cannot be combined with page filters.',
    });
  }
  const view = query.view ?? 'active';
  if (view === 'trash' && query.sort && !trashSorts.includes(query.sort)) {
    context.addIssue({ code: 'custom', message: 'Trash supports deletion-date sorting only.' });
  }
  if (view !== 'trash' && query.sort && !normalSorts.includes(query.sort)) {
    context.addIssue({ code: 'custom', message: 'This view does not support deletion-date sorting.' });
  }
  if (view === 'recent' && query.sort && query.sort !== 'newest') {
    context.addIssue({ code: 'custom', message: 'Recent files are always newest first.' });
  }
});

export function createFileRouter({ fileService, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/', asyncHandler(async (request, response) => {
    const query = listSchema.parse(request.query);
    const usePageMode = query.page !== undefined
      || query.search !== undefined
      || query.sort !== undefined
      || query.visibility !== undefined
      || query.view !== undefined;
    const result = usePageMode
      ? await fileService.listPage({
        ownerId: request.auth.user.id,
        page: query.page ?? 1,
        limit: query.limit,
        search: query.search || undefined,
        sort: query.sort ?? (query.view === 'trash' ? 'deleted-newest' : 'newest'),
        visibility: query.visibility,
        view: query.view ?? 'active',
      })
      : await fileService.list({ ownerId: request.auth.user.id, ...query });
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

  router.patch('/:fileId/favorite', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const { favorite } = favoriteSchema.parse(request.body);
    const file = await fileService.setFavorite({ ownerId: request.auth.user.id, fileId, favorite });
    response.json({ file });
  }));

  router.post('/:fileId/trash', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const file = await fileService.moveToTrash({ ownerId: request.auth.user.id, fileId });
    response.json({ file });
  }));

  router.post('/:fileId/restore', auth.requireCsrf, asyncHandler(async (request, response) => {
    const fileId = fileIdSchema.parse(request.params.fileId);
    const file = await fileService.restore({ ownerId: request.auth.user.id, fileId });
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
