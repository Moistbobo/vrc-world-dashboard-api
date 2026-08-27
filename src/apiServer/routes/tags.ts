import { Router } from 'express';
import { getWorldRepository } from '../../db/worldRepository';
import { getTagRepository } from '../../db/tagRepository';
import { requirePermission } from '../middleware/auth';

const router = Router();

export const FALLBACK_EMOJI = '❓';
export const FALLBACK_HEX_COLOR = '#94a3b8';

router.get(
  '/api/tags',
  requirePermission('tags:read'),
  async (_request, response) => {
    const [uniqueTags, canonicalTags] = await Promise.all([
      getWorldRepository().getUniqueTags(),
      getTagRepository().getAll()
    ]);
    const counts = new Map(uniqueTags.map(({ tag, count }) => [tag, count]));
    const meta = new Map(canonicalTags.map((t) => [t.tag, t]));
    const allTags = new Set<string>([
      ...canonicalTags.map((t) => t.tag),
      ...uniqueTags.map((t) => t.tag)
    ]);
    const tags = Array.from(allTags, (tag) => ({
      tag,
      count: counts.get(tag) ?? 0,
      emoji: meta.get(tag)?.emoji ?? FALLBACK_EMOJI,
      hexColor: meta.get(tag)?.hexColor ?? FALLBACK_HEX_COLOR
    })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    response.send({ tags });
  }
);

export default router;
