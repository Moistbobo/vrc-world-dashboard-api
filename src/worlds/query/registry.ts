import type {
  Field,
  Op,
  QueryCondition,
  Script,
  SortField,
  SqlParam
} from './types';

export type Binder = (value: SqlParam) => string;

export function createBinder(params: SqlParam[]): Binder {
  return (value) => {
    params.push(value);
    return `$${params.length}`;
  };
}

export type FieldKind =
  | 'text'
  | 'numeric'
  | 'date'
  | 'array'
  | 'junction'
  | 'quality'
  | 'highPriority';

export interface FieldSpec {
  kind: FieldKind;
  ops: Op[];
  column?: string;
  table?: string;
  junctionColumn?: string;
}

export const SCRIPT_PATTERNS: Record<Script, string> = {
  latin: '[A-Za-z\\u00c0-\\u024f]',
  cyrillic: '[\\u0400-\\u04ff]',
  greek: '[\\u0370-\\u03ff]',
  cjk: '[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]',
  japanese: '[\\u3040-\\u30ff]',
  korean: '[\\uac00-\\ud7af]',
  arabic: '[\\u0600-\\u06ff]'
};

export const SORT_EXPRESSIONS: Record<SortField, string> = {
  addedAt: 'COALESCE(wr.internal_add_date, wr.created_at)',
  createdAt: 'wr.created_at',
  updatedAt: 'wr.updated_at',
  capacity: 'wr.capacity',
  name: 'wr.name',
  author: 'wr.author_name',
  quality: 'wr.quality'
};

export const SORT_FIELDS = Object.keys(SORT_EXPRESSIONS) as SortField[];

export const NEGATIVE_OPS: Partial<Record<Op, Op>> = {
  ne: 'eq',
  not_contains: 'contains',
  not_has: 'has'
};

const TEXT_OPS: Op[] = [
  'eq',
  'ne',
  'in',
  'contains',
  'prefix',
  'not_contains',
  'script'
];
const NUMERIC_OPS_ALLOWED: Op[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in'
];
const DATE_OPS_ALLOWED: Op[] = ['before', 'after', 'between'];
const MEMBERSHIP_OPS: Op[] = ['has', 'hasAny', 'hasAll', 'not_has'];

export const FIELD_SPECS: Record<Field, FieldSpec> = {
  name: { kind: 'text', ops: TEXT_OPS, column: 'wr.name' },
  author: { kind: 'text', ops: TEXT_OPS, column: 'wr.author_name' },
  worldId: { kind: 'text', ops: TEXT_OPS, column: 'wr.world_id' },
  source: { kind: 'text', ops: TEXT_OPS, column: 'wr.source_content' },
  capacity: {
    kind: 'numeric',
    ops: NUMERIC_OPS_ALLOWED,
    column: 'wr.capacity'
  },
  addedAt: {
    kind: 'date',
    ops: DATE_OPS_ALLOWED,
    column: 'COALESCE(wr.internal_add_date, wr.created_at)'
  },
  createdAt: { kind: 'date', ops: DATE_OPS_ALLOWED, column: 'wr.created_at' },
  updatedAt: { kind: 'date', ops: DATE_OPS_ALLOWED, column: 'wr.updated_at' },
  platform: {
    kind: 'array',
    ops: MEMBERSHIP_OPS,
    column: 'wr.platforms'
  },
  tag: {
    kind: 'junction',
    ops: MEMBERSHIP_OPS,
    table: 'world_tags',
    junctionColumn: 'tag'
  },
  flag: {
    kind: 'junction',
    ops: MEMBERSHIP_OPS,
    table: 'world_flags',
    junctionColumn: 'flag'
  },
  quality: { kind: 'quality', ops: ['eq', 'ne', 'isNull'] },
  highPriority: { kind: 'highPriority', ops: ['eq'] }
};

type Builder = (
  spec: FieldSpec,
  condition: QueryCondition,
  bind: Binder
) => string;

const TEXT_BUILDERS: Partial<Record<Op, Builder>> = {
  eq: (s, c, b) => `${s.column} = ${b(c.value!)}`,
  ne: (s, c, b) => `${s.column} <> ${b(c.value!)}`,
  in: (s, c, b) => `${s.column} IN (${c.values!.map((v) => b(v)).join(', ')})`,
  contains: (s, c, b) => `${s.column} ILIKE ${b(`%${c.value}%`)}`,
  prefix: (s, c, b) => `${s.column} ILIKE ${b(`${c.value}%`)}`,
  not_contains: (s, c, b) => `${s.column} NOT ILIKE ${b(`%${c.value}%`)}`,
  script: (s, c, b) => `${s.column} ~ ${b(SCRIPT_PATTERNS[c.value as Script])}`
};

const NUMERIC_OPERATORS: Partial<Record<Op, string>> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<='
};

const NUMERIC_BUILDERS: Partial<Record<Op, Builder>> = Object.fromEntries(
  Object.entries(NUMERIC_OPERATORS).map(([op, symbol]) => [
    op,
    (s: FieldSpec, c: QueryCondition, b: Binder) =>
      `${s.column} ${symbol} ${b(Number(c.value))}`
  ])
) as Partial<Record<Op, Builder>>;

NUMERIC_BUILDERS.between = (s, c, b) =>
  `${s.column} BETWEEN ${b(Number(c.value))} AND ${b(Number(c.value2))}`;
NUMERIC_BUILDERS.in = (s, c, b) =>
  `${s.column} IN (${c.values!.map((v) => b(Number(v))).join(', ')})`;

const DATE_BUILDERS: Partial<Record<Op, Builder>> = {
  before: (s, c, b) => `${s.column} < ${b(Number(c.value))}`,
  after: (s, c, b) => `${s.column} > ${b(Number(c.value))}`,
  between: (s, c, b) =>
    `${s.column} BETWEEN ${b(Number(c.value))} AND ${b(Number(c.value2))}`
};

const ARRAY_BUILDERS: Partial<Record<Op, Builder>> = {
  has: (s, c, b) => `${b(c.value!)} = ANY(${s.column})`,
  hasAny: (s, c, b) =>
    `(${c.values!.map((v) => `${b(v)} = ANY(${s.column})`).join(' OR ')})`,
  hasAll: (s, c, b) =>
    `(${c.values!.map((v) => `${b(v)} = ANY(${s.column})`).join(' AND ')})`,
  not_has: (s, c, b) => `NOT (${b(c.value!)} = ANY(${s.column}))`
};

function junctionMembers(
  spec: FieldSpec,
  values: string[],
  bind: Binder
): string {
  const placeholders = values.map((v) => bind(v)).join(', ');
  return `wr.world_id IN (SELECT world_id FROM ${spec.table} WHERE ${spec.junctionColumn} IN (${placeholders}))`;
}

const JUNCTION_BUILDERS: Partial<Record<Op, Builder>> = {
  has: (s, c, b) => junctionMembers(s, [c.value!], b),
  hasAny: (s, c, b) => junctionMembers(s, c.values!, b),
  hasAll: (s, c, b) =>
    `wr.world_id IN (SELECT s.world_id FROM (SELECT world_id, COUNT(*) c FROM ${s.table} WHERE ${s.junctionColumn} IN (${c.values!.map((v) => b(v)).join(', ')}) GROUP BY world_id) s WHERE s.c = ${b(c.values!.length)})`,
  not_has: (s, c, b) =>
    `wr.world_id NOT IN (SELECT world_id FROM ${s.table} WHERE ${s.junctionColumn} IN (${b(c.value!)}) )`
};

const QUALITY_BUILDERS: Partial<Record<Op, Builder>> = {
  eq: (_s, c, b) =>
    c.value === 'null' ? 'wr.quality IS NULL' : `wr.quality = ${b(c.value!)}`,
  ne: (_s, c, b) =>
    c.value === 'null'
      ? 'wr.quality IS NOT NULL'
      : `wr.quality <> ${b(c.value!)}`,
  isNull: () => 'wr.quality IS NULL'
};

const HIGH_PRIORITY_BUILDERS: Partial<Record<Op, Builder>> = {
  eq: (_s, c) =>
    c.value === 'true'
      ? `wr.world_id IN (SELECT world_id FROM high_priority_worlds)`
      : `wr.world_id NOT IN (SELECT world_id FROM high_priority_worlds)`
};

export const BUILDERS: Record<FieldKind, Partial<Record<Op, Builder>>> = {
  text: TEXT_BUILDERS,
  numeric: NUMERIC_BUILDERS,
  date: DATE_BUILDERS,
  array: ARRAY_BUILDERS,
  junction: JUNCTION_BUILDERS,
  quality: QUALITY_BUILDERS,
  highPriority: HIGH_PRIORITY_BUILDERS
};
