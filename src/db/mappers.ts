/**
 * Central place to undo pg's decode drift: bigint/numeric/count values come
 * back as JS strings, and a NULL/empty array column may come back as null.
 * Keep every coercion here so the row mappers never repeat it.
 */
export function toNumber(value: unknown): number {
  return value === null || value === undefined ? NaN : Number(value);
}

export function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}
