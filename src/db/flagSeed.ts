/**
 * The seed flags for the `flags` catalog table (migration 014). Curator-set
 * warning/negative markers, kept disjoint from the automatically-extracted
 * taxonomy tags. The catalog is user-extensible at runtime, so this list is
 * only the initial seed, not the full set forever.
 */
export const FLAG_SEED: string[] = [
  'poor performance',
  'low quality',
  'furry',
  'AI slop',
  'booth slop'
];
