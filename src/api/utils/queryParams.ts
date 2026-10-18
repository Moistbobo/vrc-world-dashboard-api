export function parseStringListQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;

  const sources = Array.isArray(raw) ? raw.map(String) : [String(raw)];

  const values = sources
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  // Deduplicate while preserving first-appearance order
  const seen = new Set<string>();
  return values.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

export function parseIntegerParam(
  raw: unknown,
  options: { min?: number; max?: number; name: string }
): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${options.name} must be an integer`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${options.name} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${options.name} must be at most ${options.max}`);
  }

  return value;
}
