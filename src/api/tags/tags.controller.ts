import { Controller, Get } from '@nestjs/common';
import { WorldRepository } from '../../db/worldRepository';
import { TagRepository } from '../../db/tagRepository';
import { RequirePermission } from '../auth/require-permission.decorator';

export const FALLBACK_EMOJI = '❓';
export const FALLBACK_HEX_COLOR = '#94a3b8';

interface TagSummary {
  tag: string;
  count: number;
  emoji: string;
  hexColor: string;
}

@Controller('tags')
export class TagsController {
  constructor(
    private readonly worlds: WorldRepository,
    private readonly tags: TagRepository
  ) {}

  @Get()
  @RequirePermission('tags:read')
  async list(): Promise<{ tags: TagSummary[] }> {
    const [uniqueTags, canonicalTags] = await Promise.all([
      this.worlds.getUniqueTags(),
      this.tags.getAll()
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
    return { tags };
  }
}
