import {
  decodeWorldsQueryParam,
  encodeWorldsQueryParam,
  isSortField,
  parseWorldsQuery
} from './parse';
import { compileWorldsQuery } from './compile';
import { WorldsQueryError, type WorldsQuery } from './types';

function condition(
  field: string,
  op: string,
  extra: Record<string, unknown> = {}
) {
  return { field, op, ...extra };
}

function tree(conditions: unknown[], connector = 'and'): unknown {
  return { groups: [{ connector, conditions }] };
}

function expectQueryError(fn: () => unknown, ...fragments: string[]) {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(WorldsQueryError);
  const message = (thrown as Error).message;
  for (const fragment of fragments) {
    expect(message).toContain(fragment);
  }
}

describe('parseWorldsQuery', () => {
  test('parses a valid tree and defaults the group connector', () => {
    const parsed = parseWorldsQuery({
      groups: [{ conditions: [condition('tag', 'has', { value: 'kino' })] }]
    });
    expect(parsed).toEqual({
      groups: [
        {
          connector: 'and',
          conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
        }
      ]
    });
  });

  test('rejects a non-object query', () => {
    expectQueryError(() => parseWorldsQuery('nope'), 'groups');
  });

  test('dedupes values while preserving first-appearance order', () => {
    const parsed = parseWorldsQuery(
      tree([condition('tag', 'hasAll', { values: ['kino', 'kino', 'horror'] })])
    );
    expect(parsed.groups[0].conditions[0].values).toEqual(['kino', 'horror']);
  });

  test('rejects a missing groups array', () => {
    expectQueryError(() => parseWorldsQuery({}), 'groups');
  });

  test('rejects prototype-chain field names instead of throwing', () => {
    for (const field of ['constructor', 'toString', '__proto__']) {
      expectQueryError(
        () => parseWorldsQuery(tree([condition(field, 'eq', { value: 'x' })])),
        field
      );
    }
  });

  test('rejects prototype-chain script names', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('name', 'script', { value: 'constructor' })])
        ),
      'name',
      'script',
      'constructor'
    );
  });

  test('AC-4 names the offending field and operator for an unknown field', () => {
    expectQueryError(
      () => parseWorldsQuery(tree([condition('bogus', 'eq', { value: 'x' })])),
      'bogus',
      'eq'
    );
  });

  test('AC-4 names the offending field and operator for an unsupported op', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('tag', 'startsWith', { value: 'x' })])
        ),
      'tag',
      'startsWith'
    );
  });

  test('rejects a non-boolean negate', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('tag', 'has', { value: 'kino', negate: 'yes' })])
        ),
      'tag',
      'has',
      'negate'
    );
  });

  test('AC-6 rejects more than eight groups', () => {
    const groups = Array.from({ length: 9 }, () => ({
      connector: 'and',
      conditions: [condition('tag', 'has', { value: 'kino' })]
    }));
    expectQueryError(() => parseWorldsQuery({ groups }), 'groups', '8');
  });

  test('AC-6 rejects more than eight conditions in a group', () => {
    const conditions = Array.from({ length: 9 }, () =>
      condition('tag', 'has', { value: 'kino' })
    );
    expectQueryError(
      () => parseWorldsQuery(tree(conditions)),
      'conditions',
      '8'
    );
  });

  test('AC-6 rejects more than twenty values', () => {
    const values = Array.from({ length: 21 }, (_v, i) => `t${i}`);
    expectQueryError(
      () => parseWorldsQuery(tree([condition('tag', 'hasAny', { values })])),
      'values',
      '20'
    );
  });

  test('AC-6 rejects a value longer than two hundred characters', () => {
    const value = 'a'.repeat(201);
    expectQueryError(
      () => parseWorldsQuery(tree([condition('tag', 'has', { value })])),
      'tag',
      'has',
      '200'
    );
  });

  test('AC-6 accepts the maximum of 64 conditions across eight groups', () => {
    const groups = Array.from({ length: 8 }, () => ({
      connector: 'and',
      conditions: Array.from({ length: 8 }, () =>
        condition('tag', 'has', { value: 'kino' })
      )
    }));
    const parsed = parseWorldsQuery({ groups });
    expect(parsed.groups).toHaveLength(8);
    expect(parsed.groups[0].conditions).toHaveLength(8);
  });

  test('AC-7 rejects capacity outside the allowed range', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(tree([condition('capacity', 'gt', { value: 100 })])),
      'capacity',
      'gt',
      'between 1 and 80'
    );
    expectQueryError(
      () => parseWorldsQuery(tree([condition('capacity', 'eq', { value: 0 })])),
      'capacity',
      'eq'
    );
  });

  test('AC-7 rejects between when value > value2', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('capacity', 'between', { value: 50, value2: 20 })])
        ),
      'capacity',
      'between',
      'value <= value2'
    );
  });

  test('AC-7 rejects an unparseable date', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('addedAt', 'after', { value: 'not-a-date' })])
        ),
      'addedAt',
      'after',
      'invalid date'
    );
  });

  test('AC-7 rejects a reversed date range', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([
            condition('createdAt', 'between', {
              value: '2024-06-02',
              value2: '2024-06-01'
            })
          ])
        ),
      'createdAt',
      'between'
    );
  });

  test('normalizes dates to epoch seconds', () => {
    const parsed = parseWorldsQuery(
      tree([condition('createdAt', 'after', { value: '2024-06-01T00:00:00Z' })])
    );
    expect(parsed.groups[0].conditions[0].value).toBe('1717200000');
  });

  test('rejects an unknown script', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('name', 'script', { value: 'nope' })])
        ),
      'name',
      'script',
      'nope'
    );
  });

  test('rejects a bad quality value', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(tree([condition('quality', 'eq', { value: 'meh' })])),
      'quality',
      'eq'
    );
  });

  test('rejects a bad highPriority value', () => {
    expectQueryError(
      () =>
        parseWorldsQuery(
          tree([condition('highPriority', 'eq', { value: 'maybe' })])
        ),
      'highPriority',
      'eq'
    );
  });

  test('AC-13 empty groups parse and compile to no filter', () => {
    const parsed = parseWorldsQuery({ groups: [] });
    expect(parsed).toEqual({ groups: [] });
    const params: string[] = [];
    expect(compileWorldsQuery(parsed, params)).toBe('');
    expect(params).toEqual([]);
  });

  test('AC-14 keeps an empty group but drops it at compile time', () => {
    const parsed = parseWorldsQuery({
      groups: [
        { connector: 'and', conditions: [] },
        {
          connector: 'and',
          conditions: [condition('tag', 'has', { value: 'kino' })]
        }
      ]
    });
    expect(parsed.groups).toHaveLength(2);
    const params: string[] = [];
    const sql = compileWorldsQuery(parsed, params);
    expect(sql).toContain('world_tags');
    expect(sql).not.toContain('OR');
    expect(params).toEqual(['kino']);
  });
});

describe('where parameter codec', () => {
  test('round-trips a tree through base64url', () => {
    const query: WorldsQuery = {
      groups: [
        {
          connector: 'or',
          conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
        }
      ]
    };
    const encoded = encodeWorldsQueryParam(query);
    expect(decodeWorldsQueryParam(encoded)).toEqual(query);
  });

  test('rejects an invalid where parameter', () => {
    expectQueryError(
      () => decodeWorldsQueryParam('!!!not-base64!!!'),
      'Invalid where parameter'
    );
  });
});

describe('isSortField', () => {
  test('accepts known fields and rejects others', () => {
    expect(isSortField('capacity')).toBe(true);
    expect(isSortField('addedAt')).toBe(true);
    expect(isSortField('bogus')).toBe(false);
    expect(isSortField(42)).toBe(false);
  });
});
