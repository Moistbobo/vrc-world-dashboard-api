import { Router } from 'express';
import { getWorldRepository } from '../../db/worldRepository';
import { requirePermission, type TokenRequest } from '../middleware/auth';

const router = Router();

// GET /api/meta
router.get(
  '/api/meta',
  requirePermission('meta:read'),
  async (request: TokenRequest, response) => {
    const canManage =
      request.token?.role.permissions.includes('worlds:write') ?? false;
    response.send(
      await getWorldRepository().getMetadataCounts({
        includeHighPriorityCount: canManage
      })
    );
  }
);

export default router;
