import {
  CAPS,
  MAX_CAPACITY,
  MIN_CAPACITY,
  WorldsQueryError,
  type Field,
  type Op,
  type QueryCondition,
  type QueryGroup,
  type SortField,
  type WorldsQuery
} from './types';
import { FIELD_SPECS, SCRIPT_PATTERNS, SORT_FIELDS } from './registry';

export function isSortField(value: unknown): value is SortField {
  return typeof value === 'string' && (SORT_FIELDS as string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireScalar(value: unknown, field: string, op: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new WorldsQueryError(
    `Field "${field}" op "${op}" requires a string value`
  );
}

function checkLength(value: string, field: string, op: string): string {
  if (value.length === 0) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" value must not be empty`
    );
  }
  if (value.length > CAPS.maxValueLength) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" value exceeds ${CAPS.maxValueLength} characters`
    );
  }
  return value;
}

function requireValue(raw: Record<string, unknown>, field: string, op: string) {
  return checkLength(requireScalar(raw.value, field, op), field, op);
}

function requireValues(
  raw: Record<string, unknown>,
  field: string,
  op: string
): string[] {
  const values = raw.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" requires a non-empty "values" array`
    );
  }
  if (values.length > CAPS.maxValues) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" has ${values.length} values, exceeds limit ${CAPS.maxValues}`
    );
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const text = checkLength(requireScalar(value, field, op), field, op);
    if (!seen.has(text)) {
      seen.add(text);
      unique.push(text);
    }
  }
  return unique;
}

function parseCapacity(raw: unknown, field: string, op: string): number {
  const value = Number(requireScalar(raw, field, op));
  if (
    !Number.isInteger(value) ||
    value < MIN_CAPACITY ||
    value > MAX_CAPACITY
  ) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" capacity must be an integer between ${MIN_CAPACITY} and ${MAX_CAPACITY}`
    );
  }
  return value;
}

function parseDate(raw: unknown, field: string, op: string): number {
  const value = requireScalar(raw, field, op);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" has an invalid date value`
    );
  }
  return Math.floor(ms / 1000);
}

function applyText(condition: QueryCondition, raw: Record<string, unknown>) {
  const { field, op } = condition;
  if (op === 'in') {
    condition.values = requireValues(raw, field, op);
    return;
  }
  const value = requireValue(raw, field, op);
  if (op === 'script' && !hasOwn(SCRIPT_PATTERNS, value)) {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" has unknown script "${value}"`
    );
  }
  condition.value = value;
}

function applyNumeric(condition: QueryCondition, raw: Record<string, unknown>) {
  const { field, op } = condition;
  if (op === 'in') {
    condition.values = requireValues(raw, field, op).map((value) =>
      String(parseCapacity(value, field, op))
    );
    return;
  }
  const value = parseCapacity(raw.value, field, op);
  if (op === 'between') {
    const value2 = parseCapacity(raw.value2, field, op);
    if (value > value2) {
      throw new WorldsQueryError(
        `Field "${field}" op "${op}" requires value <= value2`
      );
    }
    condition.value2 = String(value2);
  }
  condition.value = String(value);
}

function applyDate(condition: QueryCondition, raw: Record<string, unknown>) {
  const { field, op } = condition;
  const value = parseDate(raw.value, field, op);
  if (op === 'between') {
    const value2 = parseDate(raw.value2, field, op);
    if (value > value2) {
      throw new WorldsQueryError(
        `Field "${field}" op "${op}" requires value <= value2`
      );
    }
    condition.value2 = String(value2);
  }
  condition.value = String(value);
}

function applyMembership(
  condition: QueryCondition,
  raw: Record<string, unknown>
) {
  const { field, op } = condition;
  if (op === 'hasAny' || op === 'hasAll') {
    condition.values = requireValues(raw, field, op);
    return;
  }
  condition.value = requireValue(raw, field, op);
}

function applyQuality(condition: QueryCondition, raw: Record<string, unknown>) {
  const { field, op } = condition;
  if (op === 'isNull') {
    return;
  }
  const value = requireValue(raw, field, op);
  if (value !== 'good' && value !== 'bad' && value !== 'null') {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" value must be "good", "bad", or "null"`
    );
  }
  condition.value = value;
}

function applyHighPriority(
  condition: QueryCondition,
  raw: Record<string, unknown>
) {
  const { field, op } = condition;
  const value = requireValue(raw, field, op);
  if (value !== 'true' && value !== 'false') {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" value must be "true" or "false"`
    );
  }
  condition.value = value;
}

function parseCondition(
  raw: unknown,
  groupIndex: number,
  conditionIndex: number
): QueryCondition {
  if (!isObject(raw)) {
    throw new WorldsQueryError(
      `Condition ${groupIndex}.${conditionIndex} must be an object`
    );
  }

  const rawField = raw.field;
  const rawOp = raw.op;
  if (typeof rawField !== 'string' || !hasOwn(FIELD_SPECS, rawField)) {
    throw new WorldsQueryError(
      `Unknown field "${String(rawField)}" with op "${String(rawOp)}" in condition ${groupIndex}.${conditionIndex}`
    );
  }

  const field = rawField as Field;
  const spec = FIELD_SPECS[field];
  if (typeof rawOp !== 'string' || !(spec.ops as string[]).includes(rawOp)) {
    throw new WorldsQueryError(
      `Unsupported operator "${String(rawOp)}" for field "${field}"`
    );
  }
  const op = rawOp as Op;

  if (raw.negate !== undefined && typeof raw.negate !== 'boolean') {
    throw new WorldsQueryError(
      `Field "${field}" op "${op}" negate must be a boolean`
    );
  }

  const condition: QueryCondition = { field, op };
  if (raw.negate !== undefined) {
    condition.negate = raw.negate;
  }

  switch (spec.kind) {
    case 'text':
      applyText(condition, raw);
      break;
    case 'numeric':
      applyNumeric(condition, raw);
      break;
    case 'date':
      applyDate(condition, raw);
      break;
    case 'array':
    case 'junction':
      applyMembership(condition, raw);
      break;
    case 'quality':
      applyQuality(condition, raw);
      break;
    case 'highPriority':
      applyHighPriority(condition, raw);
      break;
  }

  return condition;
}

export function parseWorldsQuery(raw: unknown): WorldsQuery {
  if (!isObject(raw)) {
    throw new WorldsQueryError('Query must be an object with a "groups" array');
  }
  const rawGroups = raw.groups;
  if (!Array.isArray(rawGroups)) {
    throw new WorldsQueryError('Query "groups" must be an array');
  }
  if (rawGroups.length > CAPS.maxGroups) {
    throw new WorldsQueryError(
      `Query has ${rawGroups.length} groups, exceeds limit ${CAPS.maxGroups}`
    );
  }

  let totalConditions = 0;
  const groups: QueryGroup[] = rawGroups.map((rawGroup, groupIndex) => {
    if (!isObject(rawGroup)) {
      throw new WorldsQueryError(`Group ${groupIndex} must be an object`);
    }
    const connector = rawGroup.connector ?? 'and';
    if (connector !== 'and' && connector !== 'or') {
      throw new WorldsQueryError(
        `Group ${groupIndex} connector must be "and" or "or"`
      );
    }
    const rawConditions = rawGroup.conditions;
    if (!Array.isArray(rawConditions)) {
      throw new WorldsQueryError(
        `Group ${groupIndex} "conditions" must be an array`
      );
    }
    if (rawConditions.length > CAPS.maxConditionsPerGroup) {
      throw new WorldsQueryError(
        `Group ${groupIndex} has ${rawConditions.length} conditions, exceeds limit ${CAPS.maxConditionsPerGroup}`
      );
    }
    totalConditions += rawConditions.length;
    if (totalConditions > CAPS.maxTotalConditions) {
      throw new WorldsQueryError(
        `Query has more than ${CAPS.maxTotalConditions} total conditions`
      );
    }
    return {
      connector,
      conditions: rawConditions.map((condition, conditionIndex) =>
        parseCondition(condition, groupIndex, conditionIndex)
      )
    };
  });

  return { groups };
}

export function decodeWorldsQueryParam(value: string): unknown {
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    throw new WorldsQueryError('Invalid where parameter');
  }
}

export function encodeWorldsQueryParam(query: WorldsQuery): string {
  return Buffer.from(JSON.stringify(query), 'utf8').toString('base64url');
}
