import { Router } from 'express';
import { getWorldRepository } from '../../db/worldRepository';
import { requirePermission } from '../middleware/auth';
import { taxonomyTags } from '../../tags/extractor';

const router = Router();

router.get(
  '/api/tags',
  requirePermission('tags:read'),
  (_request, response) => {
    const uniqueTags = getWorldRepository().getUniqueTags();
    const counts = new Map(uniqueTags.map(({ tag, count }) => [tag, count]));
    for (const tag of taxonomyTags) {
      if (!counts.has(tag)) {
        counts.set(tag, 0);
      }
    }
    const tags = Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
    );
    response.send({ tags });
  }
);

export default router;
