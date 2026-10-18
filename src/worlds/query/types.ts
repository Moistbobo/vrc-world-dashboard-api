export type SqlParam = string | number | string[];

export type Field =
  | 'name'
  | 'author'
  | 'worldId'
  | 'source'
  | 'capacity'
  | 'addedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'platform'
  | 'tag'
  | 'flag'
  | 'quality'
  | 'highPriority';

export type Op =
  | 'eq'
  | 'ne'
  | 'in'
  | 'contains'
  | 'prefix'
  | 'not_contains'
  | 'script'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'has'
  | 'hasAny'
  | 'hasAll'
  | 'not_has'
  | 'isNull';

export type Script =
  'latin' | 'cyrillic' | 'greek' | 'cjk' | 'japanese' | 'korean' | 'arabic';

export type SortField =
  | 'addedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'capacity'
  | 'name'
  | 'author'
  | 'quality';

export interface QueryCondition {
  field: Field;
  op: Op;
  value?: string;
  value2?: string;
  values?: string[];
  negate?: boolean;
}

export interface QueryGroup {
  connector: 'and' | 'or';
  conditions: QueryCondition[];
}

export interface WorldsQuery {
  groups: QueryGroup[];
}

export class WorldsQueryError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'WorldsQueryError';
  }
}

export const CAPS = {
  maxGroups: 8,
  maxConditionsPerGroup: 8,
  maxValues: 20,
  maxValueLength: 200,
  maxTotalConditions: 64
} as const;

export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 80;
