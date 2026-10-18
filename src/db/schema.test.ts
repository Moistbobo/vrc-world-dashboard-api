import { MIGRATIONS } from './schema';

// Folded into 001_create_world_records. Existing databases recorded these
// names in _migrations, so runMigrations must never see them again.
const RESERVED_NAMES = [
  '003_add_quality_column',
  '004_add_capacity_index',
  '005_add_internal_add_date_column',
  '007_add_package_sizes_column'
];

describe('MIGRATIONS', () => {
  it('does not reuse the reserved tombstone names', () => {
    const names = MIGRATIONS.map((m) => m.name);
    for (const reserved of RESERVED_NAMES) {
      expect(names).not.toContain(reserved);
    }
  });

  it('keeps names unique and in ascending order', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
  });
});
