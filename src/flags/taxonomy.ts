/**
 * Canonical flag taxonomy, loaded from the `flags` catalog table at boot.
 * Keyed by lowercase form so lookups canonicalize input; values keep the
 * catalog's exact spelling (e.g. 'AI slop'). The map is empty until
 * setFlagTaxonomy() runs; validation fails loudly rather than silently
 * accepting nothing, so an unloaded taxonomy is a boot error, not a quiet
 * data loss.
 */
let flagTaxonomy: ReadonlyMap<string, string> | null = null;

/** Replace the loaded taxonomy set. Used by boot wiring and tests. */
export function setFlagTaxonomy(flags: Iterable<string>): void {
  flagTaxonomy = new Map(
    Array.from(flags, (flag) => [flag.toLowerCase(), flag] as const)
  );
}

/** Clear the loaded taxonomy, forcing validateFlags() to throw until reloaded. */
export function clearFlagTaxonomy(): void {
  flagTaxonomy = null;
}

/**
 * Validate a list of flags against the taxonomy. Canonicalizes each entry
 * (trim + lowercase, resolved to the catalog's spelling), dedupes preserving
 * first-occurrence order, and reports entries not in the catalog as invalid.
 */
export function validateFlags(flags: string[]): {
  valid: string[];
  invalid: string[];
} {
  if (!flagTaxonomy) {
    throw new Error(
      'Flag taxonomy not loaded. Call setFlagTaxonomy() before validating flags.'
    );
  }
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const flag of flags) {
    const catalog = flagTaxonomy.get(flag.trim().toLowerCase());
    if (catalog) {
      if (!seen.has(catalog)) {
        seen.add(catalog);
        valid.push(catalog);
      }
    } else {
      invalid.push(flag);
    }
  }
  return { valid, invalid };
}
