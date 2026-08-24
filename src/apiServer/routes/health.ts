import { Router } from 'express';
import { getWorldRepository } from '../../db/worldRepository';

const router = Router();

router.get('/api/health', async (_request, response) => {
  const count = await getWorldRepository().count();
  response.send({
    status: 'ok',
    worldCount: count,
    dbVersion: 1
  });
});

export default router;
