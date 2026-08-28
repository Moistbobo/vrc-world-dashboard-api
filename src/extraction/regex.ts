import Config from '../config';
import logger from '../logger';

const VRCHAT_WORLD_ID_REGEX = /wrld_[a-f0-9-]{36}/;
const GENERIC_LINK_REGEX = /https?:\/\/\S+/;
const TWITTER_LINK_REGEX =
  /(?:https?:\/\/)?(?:x\.com|twitter\.com|fixupx\.com|vxtwitter\.com)\/([^?\s]+)/;

// Configurable terms for world name extraction
const WORLD_TERMS = Config.WORLD_NAME_MATCHERS;

// Configurable terms for author name extraction
const AUTHOR_TERMS = Config.AUTHOR_NAME_MATCHERS;

// Custom matchers for specific Twitter link patterns
export const customMatchers = {
  n4rGm5DmrVXXz6I: {
    getWorldName: (content: string) => {
      if (!content) return null;
      const line = content.split('\n')[0]?.trim();
      return line || null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      const line = content.split('\n')[1]?.trim();
      return line || null;
    }
  },
  YSoSerious_VR: {
    getWorldName: (content: string) => {
      if (!content) return null;
      const line = content.split('\n')[0]?.trim();
      return line || null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      const line = content.split('\n')[1]?.trim();
      if (!line) return null;
      const afterBy = line.replace(/^By\s*[:：]?\s*/i, '').trim();
      return afterBy || null;
    }
  },
  tetra_moon: {
    getWorldName: (content: string) => {
      if (!content) return null;
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^ワールド[\s\u3000]+(.+)$/);
        if (m) return m[1].trim() || null;
      }
      return null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^作者様[\s\u3000]+(.+)$/);
        if (m) return m[1].trim() || null;
      }
      return null;
    }
  },
  jhn_takashi2020: {
    getWorldName: (content: string) => {
      if (!content) return null;
      const m = content.match(/WorldInfo\s*:\s*(?:\n\s*)*(.+?)\s+by\s+.+$/im);
      return m?.[1]?.trim() ?? null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      const m = content.match(/WorldInfo\s*:\s*(?:\n\s*)*.+?\s+by\s+(.+)$/im);
      return m?.[1]?.trim() ?? null;
    }
  },
  yonesuke2: {
    getWorldName: (content: string) => {
      if (!content) return null;
      const line = content.split('\n')[0]?.trim();
      return line || null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      const line = content.split('\n')[1]?.trim();
      if (!line) return null;
      const afterBy = line.replace(/^By\s*[:：]?\s*/i, '').trim();
      return afterBy || null;
    }
  },
  Katu_VRC: {
    getWorldName: (content: string) => {
      if (!content) return null;
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^ワールド\s*[:：]?\s*(.+)$/);
        if (!m) continue;
        const afterPrefix = m[1].trim();
        const byMatches = [...afterPrefix.matchAll(/\bBy\s+/gi)];
        const byMatch = byMatches[byMatches.length - 1];
        const name = byMatch
          ? afterPrefix.slice(0, byMatch.index).trim()
          : afterPrefix;
        return name || null;
      }
      return null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^ワールド\s*[:：]?\s*(.+)$/);
        if (!m) continue;
        const afterPrefix = m[1].trim();
        const byMatches = [...afterPrefix.matchAll(/\bBy\s+/gi)];
        const byMatch = byMatches[byMatches.length - 1];
        if (!byMatch) return null;
        const author = afterPrefix
          .slice(byMatch.index! + byMatch[0].length)
          .replace(/\s*#.*$/g, '')
          .trim();
        return author || null;
      }
      return null;
    }
  },
  fox_yata9: {
    getWorldName: (content: string) => {
      if (!content) return null;
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^World\s*[:：]\s*(.+)$/i);
        if (m) {
          const name = m[1]
            .trim()
            .replace(/\s*\(QUEST対応\)/g, '')
            .replace(/\s*\(iOS対応\)/g, '')
            .trim();
          return name || null;
        }
      }
      return null;
    },
    getAuthorName: (content: string) => {
      if (!content) return null;
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^By\s*[:：]\s*(.+)$/i);
        if (m) {
          const name = m[1].trim();
          return name || null;
        }
      }
      return null;
    }
  }
};

export function extractWorldId(message: string): string | null {
  if (!message) return null;
  const match = message.match(VRCHAT_WORLD_ID_REGEX);
  return match?.[0] ?? null;
}

/**
 * Returns every unique VRChat world id found in `text`, in order of first appearance.
 */
export function extractAllWorldIds(text: string): string[] {
  if (!text) return [];
  const re = new RegExp(VRCHAT_WORLD_ID_REGEX.source, 'g');
  const matches = text.match(re);
  if (!matches?.length) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of matches) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Returns every HTTP(S) link found in `text`, in order of first appearance.
 */
export function extractAllLinks(text: string): string[] {
  if (!text) return [];
  const re = new RegExp(GENERIC_LINK_REGEX.source, 'g');
  const matches = text.match(re);
  return matches ?? [];
}

/**
 * Checks whether a link points to a known Twitter/X domain.
 */
export function isTwitterLink(link: string): boolean {
  if (!link) return false;
  return TWITTER_LINK_REGEX.test(link);
}

export function removeTwitterLink(link: string): string | null {
  if (!link) return null;
  const match = link.match(TWITTER_LINK_REGEX);
  return match?.[1] ?? null;
}

/**
 * Primary function to extract world and author names
 * Tries the line-by-line approach first for better accuracy, then falls back to regex
 * @param message - The message content to search
 * @returns Object with worldName and authorName if found, null otherwise
 */
export function extractWorldAndAuthor(
  message: string
): { worldName: string; authorName: string } | null {
  if (!message) return null;

  // Try line-by-line approach first (more accurate for structured formats)
  const lineResult = extractWorldAndAuthorByLines(message);
  if (lineResult) {
    return lineResult;
  }

  // Fall back to regex approach for less structured formats
  const worldName = extractWorldName(message);
  const authorName = extractAuthorName(message);

  if (worldName && authorName) {
    return { worldName, authorName };
  }

  return null;
}

/**
 * Extracts world name from message content using configurable terms
 * @param message - The message content to search
 * @param customTerms - Optional array of additional terms to match
 * @returns The world name if found, null otherwise
 */
export function extractWorldName(
  message: string,
  customTerms: string[] = []
): string | null {
  try {
    if (!message) return null;

    const allTerms = [...WORLD_TERMS, ...customTerms];
    const termsPattern = allTerms
      .map(
        (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special characters
      )
      .join('|');

    // More flexible regex that handles various formats including Japanese
    const worldNameRegex = new RegExp(
      `(?:${termsPattern})\\s*[:：]?\\s*([^\\n\\r#]+?)(?=\\s*(?:${AUTHOR_TERMS.join('|')})|\\s*#|\\s*$|\\s*\\n)`
    );

    const match = message.match(worldNameRegex);
    return match?.[1]?.trim() ?? null;
  } catch (error) {
    logger.error('Error in extractWorldName:', error);
    return null;
  }
}

/**
 * Extracts world and author names by parsing content line by line
 * This approach is more reliable for structured formats like:
 * World: Tokyo Mood by BEAMS Summer Version
 * Author: BEAMS_STAFF_1
 * @param message - The message content to search
 * @returns Object with worldName and authorName if found, null otherwise
 */
export function extractWorldAndAuthorByLines(
  message: string
): { worldName: string; authorName: string } | null {
  if (!message) return null;

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let worldName: string | null = null;
  let authorName: string | null = null;

  for (const line of lines) {
    // Check for world name
    for (const worldTerm of WORLD_TERMS) {
      if (line.toLowerCase().startsWith(worldTerm.toLowerCase())) {
        // Handle both regular colons and Japanese full-width colons
        const colonMatch = line.match(/[:：]/);
        if (colonMatch) {
          const colonIndex = colonMatch.index!;
          worldName = line.substring(colonIndex + 1).trim();
          break;
        }
      }
    }

    // Check for author name
    for (const authorTerm of AUTHOR_TERMS) {
      if (line.toLowerCase().startsWith(authorTerm.toLowerCase())) {
        // Handle both regular colons and Japanese full-width colons
        const colonMatch = line.match(/[:：]/);
        if (colonMatch) {
          const colonIndex = colonMatch.index!;
          authorName = line.substring(colonIndex + 1).trim();
          break;
        }
      }
    }
  }

  if (worldName && authorName) {
    return { worldName, authorName };
  }

  return null;
}

/**
 * Extracts author name from message content using configurable terms
 * @param message - The message content to search
 * @param customTerms - Optional array of additional terms to match
 * @returns The author name if found, null otherwise
 */
export function extractAuthorName(
  message: string,
  customTerms: string[] = []
): string | null {
  if (!message) return null;

  const allTerms = [...AUTHOR_TERMS, ...customTerms];
  const termsPattern = allTerms
    .map(
      (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special characters
    )
    .join('|');

  // More flexible regex that handles various formats including Japanese
  const authorNameRegex = new RegExp(
    `(?:${termsPattern})\\s*[:：]?\\s*([^\\n\\r#]+?)(?=\\s*$|\\s*#|\\s*\\n)`,
    'i'
  );

  const match = message.match(authorNameRegex);
  return match?.[1]?.trim() ?? null;
}

/**
 * Attempts to extract world and author names using custom matchers
 * @param twitterLink - The Twitter link to check against custom matchers
 * @param tweetContent - The content of the tweet
 * @returns Object with worldName and authorName if custom matcher found, null otherwise
 */
export function extractWithCustomMatcher(
  twitterLink: string,
  tweetContent: string
): { worldName: string; authorName: string } | null {
  try {
    // Input validation
    if (
      !twitterLink ||
      !tweetContent ||
      typeof twitterLink !== 'string' ||
      typeof tweetContent !== 'string'
    ) {
      return null;
    }

    for (const [matcherKey, matcher] of Object.entries(customMatchers)) {
      try {
        // Safe regex testing with error handling
        const regex = new RegExp(matcherKey, 'i');
        if (regex.test(twitterLink)) {
          const worldName = matcher.getWorldName(tweetContent);
          const authorName = matcher.getAuthorName(tweetContent);

          if (worldName && authorName) {
            return { worldName, authorName };
          }
        }
      } catch (matcherError) {
        // Log error for specific matcher but continue with others
        logger.error(`Error in custom matcher ${matcherKey}:`, matcherError);
        continue;
      }
    }
  } catch (error) {
    logger.error('Error in extractWithCustomMatcher:', error);
  }

  return null;
}

/**
 * Cleans tweet content by removing all URLs/links
 * @param content - The tweet content to clean
 * @returns Cleaned content with all links removed, or empty string if error occurs
 */
export function removeLinksFromTweet(content: string): string {
  try {
    // Input validation
    if (!content || typeof content !== 'string') {
      return '';
    }

    // Remove URLs (http, https, www, etc.)
    const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

    // Safely replace URLs and handle potential regex errors
    let cleanedContent: string;
    try {
      cleanedContent = content.replace(urlRegex, '');
    } catch {
      // Fallback: use a simpler approach if regex fails
      cleanedContent = content.replace(/https?:\/\/[^\s]+/gi, '');
    }

    // Trim whitespace and return
    return cleanedContent.trim();
  } catch (error) {
    // Log error for debugging but don't crash the application
    logger.error('Error in removeLinksFromTweet:', error);

    // Return original content if cleaning fails, or empty string if content is invalid
    return typeof content === 'string' ? content.trim() : '';
  }
}
