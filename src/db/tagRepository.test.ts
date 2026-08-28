import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';
import { TagRepository } from './tagRepository';
import { TAG_SEED } from './tagSeed';

describe('tagRepository', () => {
  let queryable: TestDb['queryable'];

  beforeEach(async () => {
    ({ queryable } = createTestDb());
    await runMigrations(queryable);
  });

  it('returns every seeded canonical tag with its metadata', async () => {
    const repo = new TagRepository(queryable);
    const rows = await repo.getAll();
    expect(rows).toHaveLength(TAG_SEED.length);
    const byTag = new Map(rows.map((r) => [r.tag, r]));
    for (const seed of TAG_SEED) {
      expect(byTag.get(seed.tag)).toEqual({
        tag: seed.tag,
        emoji: seed.emoji,
        hexColor: seed.hexColor
      });
    }
  });
});
