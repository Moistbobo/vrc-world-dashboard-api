import { compileWorldsQuery, resolveSortExpression } from './compile';
import {
  WorldsQueryError,
  type Field,
  type QueryCondition,
  type WorldsQuery
} from './types';

function query(...conditions: QueryCondition[]): WorldsQuery {
  return { groups: [{ connector: 'and', conditions }] };
}

function compile(
  input: WorldsQuery,
  params: (string | number | string[])[] = []
) {
  return { sql: compileWorldsQuery(input, params), params };
}

describe('compileWorldsQuery', () => {
  test('returns an empty predicate for an undefined or empty query', () => {
    expect(compileWorldsQuery(undefined, [])).toBe('');
    expect(compileWorldsQuery({ groups: [] }, [])).toBe('');
  });

  test('parameterizes text equality', () => {
    const result = compile(query({ field: 'name', op: 'eq', value: 'Kino' }));
    expect(result.sql).toBe('(wr.name = $1)');
    expect(result.params).toEqual(['Kino']);
  });

  test('binds contains, prefix, and not_contains patterns', () => {
    expect(
      compile(query({ field: 'name', op: 'contains', value: 'Kino' }))
    ).toEqual({ sql: '(wr.name ILIKE $1)', params: ['%Kino%'] });
    expect(
      compile(query({ field: 'name', op: 'prefix', value: 'Kino' }))
    ).toEqual({ sql: '(wr.name ILIKE $1)', params: ['Kino%'] });
    expect(
      compile(query({ field: 'name', op: 'not_contains', value: 'Kino' }))
    ).toEqual({ sql: '(wr.name NOT ILIKE $1)', params: ['%Kino%'] });
  });

  test('binds every value of an in list', () => {
    const result = compile(
      query({ field: 'worldId', op: 'in', values: ['wrld_a', 'wrld_b'] })
    );
    expect(result.sql).toBe('(wr.world_id IN ($1, $2))');
    expect(result.params).toEqual(['wrld_a', 'wrld_b']);
  });

  test('binds the named script pattern', () => {
    const result = compile(
      query({ field: 'name', op: 'script', value: 'cyrillic' })
    );
    expect(result.sql).toBe('(wr.name ~ $1)');
    expect(result.params).toEqual(['[\\u0400-\\u04ff]']);
  });

  test('joins conditions with AND or OR inside a group', () => {
    const andSql = compileWorldsQuery(
      {
        groups: [
          {
            connector: 'and',
            conditions: [
              { field: 'name', op: 'eq', value: 'a' },
              { field: 'author', op: 'eq', value: 'b' }
            ]
          }
        ]
      },
      []
    );
    expect(andSql).toBe('(wr.name = $1 AND wr.author_name = $2)');

    const orSql = compileWorldsQuery(
      {
        groups: [
          {
            connector: 'or',
            conditions: [
              { field: 'name', op: 'eq', value: 'a' },
              { field: 'author', op: 'eq', value: 'b' }
            ]
          }
        ]
      },
      []
    );
    expect(orSql).toBe('(wr.name = $1 OR wr.author_name = $2)');
  });

  test('ORs the top-level groups', () => {
    const result = compileWorldsQuery(
      {
        groups: [
          {
            connector: 'and',
            conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
          },
          {
            connector: 'and',
            conditions: [{ field: 'tag', op: 'has', value: 'horror' }]
          }
        ]
      },
      []
    );
    expect(result).toBe(
      '(wr.world_id IN (SELECT world_id FROM world_tags WHERE tag IN ($1))) OR (wr.world_id IN (SELECT world_id FROM world_tags WHERE tag IN ($2)))'
    );
  });

  test('drops empty groups', () => {
    const result = compileWorldsQuery(
      {
        groups: [
          { connector: 'and', conditions: [] },
          {
            connector: 'and',
            conditions: [{ field: 'name', op: 'eq', value: 'a' }]
          }
        ]
      },
      []
    );
    expect(result).toBe('(wr.name = $1)');
  });

  test('wraps negated conditions in NOT', () => {
    const flag = compile(
      query({ field: 'flag', op: 'has', value: 'furry', negate: true })
    );
    expect(flag.sql).toBe(
      '(NOT (wr.world_id IN (SELECT world_id FROM world_flags WHERE flag IN ($1))))'
    );
    expect(flag.params).toEqual(['furry']);

    const source = compile(
      query({ field: 'name', op: 'in', values: ['a', 'b'], negate: true })
    );
    expect(source.sql).toBe('(NOT (wr.name IN ($1, $2)))');
  });

  test('normalizes a negated negative op to its positive form (no double NOT)', () => {
    const notHas = compile(
      query({ field: 'tag', op: 'not_has', value: 'kino', negate: true })
    );
    expect(notHas.sql).toBe(
      '(wr.world_id IN (SELECT world_id FROM world_tags WHERE tag IN ($1)))'
    );

    const notContains = compile(
      query({ field: 'name', op: 'not_contains', value: 'x', negate: true })
    );
    expect(notContains.sql).toBe('(wr.name ILIKE $1)');

    const ne = compile(
      query({ field: 'name', op: 'ne', value: 'x', negate: true })
    );
    expect(ne.sql).toBe('(wr.name = $1)');
  });

  test('continues parameter numbering after existing params', () => {
    const result = compile(query({ field: 'name', op: 'eq', value: 'x' }), [
      'legacy'
    ]);
    expect(result.sql).toBe('(wr.name = $2)');
    expect(result.params).toEqual(['legacy', 'x']);
  });

  test('compiles numeric comparisons and between', () => {
    expect(
      compile(query({ field: 'capacity', op: 'gte', value: '10' }))
    ).toEqual({
      sql: '(wr.capacity >= $1)',
      params: [10]
    });
    expect(
      compile(
        query({ field: 'capacity', op: 'between', value: '10', value2: '20' })
      )
    ).toEqual({ sql: '(wr.capacity BETWEEN $1 AND $2)', params: [10, 20] });
  });

  test('compiles date comparisons from epoch seconds', () => {
    const result = compile(
      query({ field: 'createdAt', op: 'before', value: '1717200000' })
    );
    expect(result.sql).toBe('(wr.created_at < $1)');
    expect(result.params).toEqual([1717200000]);
  });

  test('compiles quality null semantics', () => {
    expect(
      compile(query({ field: 'quality', op: 'eq', value: 'null' })).sql
    ).toBe('(wr.quality IS NULL)');
    expect(
      compile(query({ field: 'quality', op: 'ne', value: 'null' })).sql
    ).toBe('(wr.quality IS NOT NULL)');
    expect(compile(query({ field: 'quality', op: 'isNull' })).sql).toBe(
      '(wr.quality IS NULL)'
    );
  });

  test('compiles high priority membership', () => {
    expect(
      compile(query({ field: 'highPriority', op: 'eq', value: 'true' })).sql
    ).toBe('(wr.world_id IN (SELECT world_id FROM high_priority_worlds))');
    expect(
      compile(query({ field: 'highPriority', op: 'eq', value: 'false' })).sql
    ).toBe('(wr.world_id NOT IN (SELECT world_id FROM high_priority_worlds))');
  });

  test('compiles platform array membership without @> or &&', () => {
    expect(
      compile(query({ field: 'platform', op: 'has', value: 'android' }))
    ).toEqual({ sql: '($1 = ANY(wr.platforms))', params: ['android'] });

    const hasAny = compile(
      query({ field: 'platform', op: 'hasAny', values: ['android', 'ios'] })
    );
    expect(hasAny.sql).toBe(
      '(($1 = ANY(wr.platforms) OR $2 = ANY(wr.platforms)))'
    );
    expect(hasAny.params).toEqual(['android', 'ios']);

    const hasAll = compile(
      query({ field: 'platform', op: 'hasAll', values: ['android', 'ios'] })
    );
    expect(hasAll.sql).toBe(
      '(($1 = ANY(wr.platforms) AND $2 = ANY(wr.platforms)))'
    );
  });

  test('compiles tag hasAll as a counted subquery', () => {
    const result = compile(
      query({ field: 'tag', op: 'hasAll', values: ['kino', 'horror'] })
    );
    expect(result.sql).toBe(
      '(wr.world_id IN (SELECT s.world_id FROM (SELECT world_id, COUNT(*) c FROM world_tags WHERE tag IN ($1, $2) GROUP BY world_id) s WHERE s.c = $3))'
    );
    expect(result.params).toEqual(['kino', 'horror', 2]);
  });

  test('compiles tag not_has as a non-correlated NOT IN', () => {
    const result = compile(
      query({ field: 'tag', op: 'not_has', value: 'furry' })
    );
    expect(result.sql).toBe(
      '(wr.world_id NOT IN (SELECT world_id FROM world_tags WHERE tag IN ($1) ))'
    );
    expect(result.params).toEqual(['furry']);
  });

  test('throws a WorldsQueryError naming an unknown field', () => {
    expect(() =>
      compileWorldsQuery(
        query({ field: 'bogus' as Field, op: 'eq', value: 'x' }),
        []
      )
    ).toThrow(WorldsQueryError);
  });
});

describe('resolveSortExpression', () => {
  test('defaults to the tagged addedAt expression', () => {
    expect(resolveSortExpression()).toBe(
      'COALESCE(wr.internal_add_date, wr.created_at)'
    );
    expect(resolveSortExpression('addedAt')).toBe(
      'COALESCE(wr.internal_add_date, wr.created_at)'
    );
  });

  test('resolves capacity and the timestamp columns', () => {
    expect(resolveSortExpression('capacity')).toBe('wr.capacity');
    expect(resolveSortExpression('createdAt')).toBe('wr.created_at');
    expect(resolveSortExpression('updatedAt')).toBe('wr.updated_at');
  });

  test('throws on an unknown sort expression', () => {
    expect(() => resolveSortExpression('constructor' as never)).toThrow(
      WorldsQueryError
    );
  });
});
