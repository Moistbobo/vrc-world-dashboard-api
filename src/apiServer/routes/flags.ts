import { Router } from 'express';
import { getFlagRepository } from '../../db/flagRepository';
import { requirePermission } from '../middleware/auth';

const router = Router();

router.get(
  '/api/flags',
  requirePermission('tags:read'),
  async (_request, response) => {
    const [catalogFlags, countsByFlag] = await Promise.all([
      getFlagRepository().getAll(),
      getFlagRepository().countByFlag()
    ]);
    const counts = new Map(
      countsByFlag.map(({ flag, count }) => [flag, count])
    );
    const flags = Array.from(catalogFlags, (flag) => ({
      flag,
      count: counts.get(flag) ?? 0
    })).sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));
    response.send({ flags });
  }
);

export default router;
