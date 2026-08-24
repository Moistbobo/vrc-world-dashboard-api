import logger from '../logger';

/**
 * Canonical taxonomy tags for VRChat world categorization.
 */
export const taxonomyTags: string[] = [
  'kino',
  'chill',
  'comfy',
  'adventure',
  'horror',
  'game',
  'particle live / vrmv',
  'gallery',
  'meme',
  'puzzle',
  'driving',
  'flying',
  'tech',
  'nature',
  'gamerip',
  'portal',
  'liminal',
  'moon',
  'space',
  'day',
  'night',
  'dawn',
  'dusk',
  'bar',
  'club',
  'beach',
  'urban',
  'aquatic'
];

const TAXONOMY = new Set<string>(taxonomyTags);

/**
 * Maps variant spellings / synonyms to their canonical taxonomy form.
 */
const CANONICAL_MAP: Record<string, string> = {
  'particle live': 'particle live / vrmv',
  particlelive: 'particle live / vrmv',
  vrmv: 'particle live / vrmv',
  パーティクルライブ: 'particle live / vrmv'
};

/** Regex patterns for structured tag lines (case-insensitive). */
const ALL_PREFIXES = [
  /^tags?\s*[:：]\s*/i,
  /^tag\(s\)\s*[:：]\s*/i,
  /^categor(?:y|ies)\s*[:：]\s*/i,
  /^types?\s*[:：]\s*/i,
  /^map types?\s*[:：]\s*/i,
  /^タグ\s*[:：]\s*/i,
  /^種類\s*[:：]\s*/i,
  /^カテゴリー\s*[:：]\s*/i
];

/**
 * Extract tags from structured prefix lines.
 * e.g. "Tags: horror, game" or "Tags: horror game chill"
 */
function extractStructuredTags(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const prefix of ALL_PREFIXES) {
      const match = line.match(prefix);
      if (!match) continue;

      const afterPrefix = line.slice(match[0].length).trim();
      if (!afterPrefix) continue;

      // Try the entire post-prefix string as a single tag first
      // (handles multi-word tags like "particle live" before splitting)
      const whole = afterPrefix
        .toLowerCase()
        .replace(/^[([{'"`]+/, '')
        .replace(/[)\]}'"`?.!]+$/, '');
      const wholeValidated = validate(whole);
      if (wholeValidated && !seen.has(wholeValidated)) {
        seen.add(wholeValidated);
        result.push(wholeValidated);
        break;
      }

      const tokens = afterPrefix
        .split(/[,，、\s]+/)
        .map((t) => t.trim().toLowerCase())
        .map((t) => t.replace(/^[([{'"`]+/, '').replace(/[)\]}'"`?.!]+$/, ''))
        .filter((t) => t.length > 0);

      for (const token of tokens) {
        if (seen.has(token)) continue;
        seen.add(token);
        result.push(token);
      }

      break; // only one prefix per line
    }
  }

  return result;
}

/** Apply canonicalization map. */
function canonicalize(token: string): string {
  return CANONICAL_MAP[token] ?? token;
}

/** Validate a token against the taxonomy. */
function validate(token: string): string | null {
  const canonical = canonicalize(token);
  if (TAXONOMY.has(canonical)) {
    return canonical;
  }
  return null;
}

/**
 * Main entry point: extract validated taxonomy tags from message content.
 *
 * Pass 1 – structured lines: looks for lines starting with known prefixes
 * (Tags:, Tag:, Category:, etc.) and validates the tokens against the taxonomy.
 *
 * Pass 2 – unstructured "pure tag" lines: any line whose tokens are *all*
 * valid taxonomy terms (after stripping punctuation) is also accepted.
 * This handles messages like "https://... kino, chill" where the tags
 * appear inline without a prefix.
 */
export function extractTags(content: string): string[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  // ── Pass 1: structured prefix lines ──
  for (const token of extractStructuredTags(content)) {
    const validated = validate(token);
    if (!validated) continue;
    if (seen.has(validated)) continue;

    seen.add(validated);
    result.push(validated);
  }

  // ── Pass 2: unstructured lines that consist entirely of taxonomy terms ──
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip lines that look like they have a structured prefix (already handled)
    // by checking if they start with a known prefix pattern.
    const hasPrefix = ALL_PREFIXES.some((p) => p.test(line));
    if (hasPrefix) continue;

    const tokens = line
      .split(/[,，、\s]+/)
      .map((t) => t.trim().toLowerCase())
      .map((t) => t.replace(/^[([{'"`]+/, '').replace(/[)\]}'"`?.!]+$/, ''))
      .filter((t) => t.length > 0);

    if (tokens.length === 0) continue;

    // Only accept lines where a majority of tokens are valid taxonomy terms,
    // and at least one token is valid. This handles lines like
    // "meme game (little) horror" where most words are tags but a few
    // aren't (e.g. descriptors in parentheses).
    const validTokens = tokens.filter((t) => validate(t) !== null);
    const validRatio = validTokens.length / tokens.length;
    if (validTokens.length === 0 || validRatio < 0.5) continue;

    for (const token of validTokens) {
      const validated = validate(token)!;
      if (seen.has(validated)) continue;
      seen.add(validated);
      result.push(validated);
    }
  }

  logger.debug(`Extracted tags from content: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Validate a list of tags against the taxonomy. Returns the canonical
 * forms of valid tags (deduplicated, first-occurrence order) and the
 * original values of invalid tags.
 */
export function validateTags(tags: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const canonical = validate(tag.trim().toLowerCase());
    if (canonical) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        valid.push(canonical);
      }
    } else {
      invalid.push(tag);
    }
  }
  return { valid, invalid };
}
