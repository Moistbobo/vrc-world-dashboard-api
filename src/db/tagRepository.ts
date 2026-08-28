import type { Queryable } from './client';
import { getQueryable } from './pool';

export interface TagMetaRow {
  tag: string;
  emoji: string;
  hexColor: string;
}

export class TagRepository {
  private db: Queryable;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
  }

  async getAll(): Promise<TagMetaRow[]> {
    const result = await this.db.query<{
      tag: string;
      emoji: string;
      hex_color: string;
    }>(`SELECT tag, emoji, hex_color FROM tags ORDER BY tag`);
    return result.rows.map((r) => ({
      tag: r.tag,
      emoji: r.emoji,
      hexColor: r.hex_color
    }));
  }
}

let repoInstance: TagRepository | null = null;

export function getTagRepository(): TagRepository {
  if (!repoInstance) {
    repoInstance = new TagRepository();
  }
  return repoInstance;
}

/** Reset the singleton (useful in tests). */
export function resetTagRepository(): void {
  repoInstance = null;
}
