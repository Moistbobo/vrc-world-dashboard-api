import Database from 'better-sqlite3';
import { runMigrations } from './schema';
import { WorldRepository } from './worldRepository';

describe('world records', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  function addWorld(
    worldId: string,
    guildId: string,
    tags: string[] = [],
    sourceContent: string | null = null
  ): void {
    new WorldRepository(db).upsert({
      worldId,
      guildId,
      messageId: '1250000000000000000',
      name: 'Test World',
      authorName: 'Test Author',
      capacity: 16,
      platforms: ['standalonewindows'],
      tags,
      imageUrl: null,
      sourceContent,
      vrchatData: null,
      packageSizes: []
    });
  }

  describe('updateQuality', () => {
    test('sets quality to good', () => {
      addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(db);
      expect(repo.updateQuality('wrld_abc', 'guild-1', 'good')).toBe(true);
      expect(repo.getByWorldAndGuild('wrld_abc', 'guild-1')?.quality).toBe(
        'good'
      );
    });

    test('clears quality with null', () => {
      addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(db);
      repo.updateQuality('wrld_abc', 'guild-1', 'good');
      expect(repo.updateQuality('wrld_abc', 'guild-1', null)).toBe(true);
      expect(
        repo.getByWorldAndGuild('wrld_abc', 'guild-1')?.quality
      ).toBeNull();
    });

    test('clearing an already-null quality reports unchanged', () => {
      addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(db);
      expect(repo.updateQuality('wrld_abc', 'guild-1', null)).toBe(false);
    });

    test('returns false when the world does not exist', () => {
      const repo = new WorldRepository(db);
      expect(repo.updateQuality('wrld_abc', 'guild-1', 'good')).toBe(false);
    });
  });

  describe('updateTagsOnly', () => {
    test('sets tags without modifying source_content', () => {
      addWorld('wrld_abc', 'guild-1', ['kino'], 'original source');
      const repo = new WorldRepository(db);

      expect(
        repo.updateTagsOnly('wrld_abc', 'guild-1', ['horror', 'game'])
      ).toBe(true);

      const record = repo.getByWorldAndGuild('wrld_abc', 'guild-1')!;
      expect(record.tags).toEqual(['horror', 'game']);
      expect(record.sourceContent).toBe('original source');
    });

    test('returns false when the tags are unchanged', () => {
      addWorld('wrld_abc', 'guild-1', ['horror']);
      const repo = new WorldRepository(db);

      expect(repo.updateTagsOnly('wrld_abc', 'guild-1', ['horror'])).toBe(
        false
      );
    });

    test('returns false when the record does not exist', () => {
      const repo = new WorldRepository(db);

      expect(repo.updateTagsOnly('wrld_missing', 'guild-1', ['horror'])).toBe(
        false
      );
    });
  });
});

describe('migration 009_grant_tags_write_to_curator_and_admin', () => {
  test('upgrades a pre-existing role, is idempotent, and is safe when a role row is missing', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE roles (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL UNIQUE,
        permissions  TEXT    NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      INSERT INTO roles (name, permissions) VALUES
        ('curator', '["worlds:read","tags:read","meta:read","worlds:write"]');
      CREATE TABLE _migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      INSERT INTO _migrations (name) VALUES
        ('001_create_world_records'),
        ('002_create_deleted_world_records'),
        ('003_add_quality_column'),
        ('004_add_capacity_index'),
        ('005_add_internal_add_date_column'),
        ('006_create_roles_and_api_tokens'),
        ('007_add_package_sizes_column'),
        ('008_create_high_priority_worlds');
    `);

    runMigrations(db);

    expect(
      (
        db
          .prepare('SELECT permissions FROM roles WHERE name = ?')
          .get('curator') as {
          permissions: string;
        }
      ).permissions
    ).toBe(
      '["worlds:read","tags:read","meta:read","worlds:write","tags:write"]'
    );

    db.prepare(
      "DELETE FROM _migrations WHERE name = '009_grant_tags_write_to_curator_and_admin'"
    ).run();
    runMigrations(db);

    expect(
      (
        db
          .prepare('SELECT permissions FROM roles WHERE name = ?')
          .get('curator') as {
          permissions: string;
        }
      ).permissions
    ).toBe(
      '["worlds:read","tags:read","meta:read","worlds:write","tags:write"]'
    );

    db.close();
  });
});
