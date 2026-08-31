import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export function createStorageRouter({ storageStatsService, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/stats', asyncHandler(async (request, response) => {
    const stats = await storageStatsService.getForOwner(request.auth.user.id);
    response.json({ stats });
  }));

  return router;
}
