import {
  BUILDERS,
  FIELD_SPECS,
  NEGATIVE_OPS,
  SORT_EXPRESSIONS,
  createBinder,
  type Binder
} from './registry';
import {
  WorldsQueryError,
  type QueryCondition,
  type QueryGroup,
  type SortField,
  type SqlParam,
  type WorldsQuery
} from './types';

function compileCondition(condition: QueryCondition, bind: Binder): string {
  const spec = FIELD_SPECS[condition.field];
  if (!spec) {
    throw new WorldsQueryError(
      `Unknown field "${condition.field}" with op "${condition.op}"`
    );
  }

  let op = condition.op;
  let negate = condition.negate === true;
  const mapped = NEGATIVE_OPS[op];
  if (negate && mapped) {
    op = mapped;
    negate = false;
  }

  const builder = BUILDERS[spec.kind][op];
  if (!builder) {
    throw new WorldsQueryError(
      `Unsupported operator "${op}" for field "${condition.field}"`
    );
  }

  const fragment = builder(spec, condition, bind);
  return negate ? `NOT (${fragment})` : fragment;
}

function compileGroup(group: QueryGroup, bind: Binder): string {
  const fragments = group.conditions.map((condition) =>
    compileCondition(condition, bind)
  );
  if (fragments.length === 0) {
    return '';
  }
  const joiner = group.connector === 'or' ? ' OR ' : ' AND ';
  return fragments.join(joiner);
}

export function compileWorldsQuery(
  query: WorldsQuery | undefined,
  params: SqlParam[]
): string {
  if (!query || !Array.isArray(query.groups)) {
    return '';
  }
  const bind = createBinder(params);
  const groups = query.groups
    .map((group) => compileGroup(group, bind))
    .filter((fragment) => fragment !== '');
  if (groups.length === 0) {
    return '';
  }
  return groups.map((fragment) => `(${fragment})`).join(' OR ');
}

export function resolveSortExpression(field?: SortField): string {
  const key = field ?? 'addedAt';
  if (!Object.prototype.hasOwnProperty.call(SORT_EXPRESSIONS, key)) {
    throw new WorldsQueryError(`Unknown sortField "${String(field)}"`);
  }
  return SORT_EXPRESSIONS[key];
}
