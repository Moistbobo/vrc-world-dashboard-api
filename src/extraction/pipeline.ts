import { closest, distance } from 'fastest-levenshtein';
import { searchWorldsByName } from '../vrchat/client';
import getTweetContent from './vxtwitter';
import {
  extractAuthorName,
  extractWorldName,
  extractWithCustomMatcher,
  removeLinksFromTweet,
  extractWorldAndAuthor,
  extractAllWorldIds,
  extractAllLinks,
  isTwitterLink
} from './regex';
import logger from '../logger';

export interface LimitedWorld {
  id: string;
  name: string;
  authorName: string;
  capacity: number;
  imageUrl: string;
  unityPackages: { platform?: string }[];
}

/**
 * Extracts all world IDs from message content, including resolving Twitter links.
 * Returns world IDs in order of first appearance, deduplicated.
 */
export const extractAllWorldIdsFromMessage = async (
  content: string
): Promise<{ worldId: string; sourceContent: string }[]> => {
  const results: { worldId: string; sourceContent: string }[] = [];
  const seen = new Set<string>();

  // 1. Direct world IDs
  const directIds = extractAllWorldIds(content);
  for (const worldId of directIds) {
    if (!seen.has(worldId)) {
      seen.add(worldId);
      results.push({ worldId, sourceContent: content });
    }
  }

  // 2. Twitter links
  const links = extractAllLinks(content);
  for (const link of links) {
    if (!isTwitterLink(link)) continue;

    const tweetContent = await getTweetContent(link);
    if (!tweetContent) continue;

    // Try direct world ID(s) in tweet first
    const tweetWorldIds = extractAllWorldIds(tweetContent);
    if (tweetWorldIds.length > 0) {
      for (const worldId of tweetWorldIds) {
        if (!seen.has(worldId)) {
          seen.add(worldId);
          results.push({ worldId, sourceContent: content });
        }
      }
      continue;
    }

    // Fall back to parsing world name/author from tweet
    const worldIdFromText = await parseWorldInfoFromPlainText(
      link,
      tweetContent
    );
    if (worldIdFromText && !seen.has(worldIdFromText)) {
      seen.add(worldIdFromText);
      results.push({ worldId: worldIdFromText, sourceContent: content });
    }
  }

  return results;
};

/**
 * Extracts world ID from message content or Twitter links (first match only)
 */
export const extractWorldIdFromMessage = async (
  content: string
): Promise<string | null> => {
  const all = await extractAllWorldIdsFromMessage(content);
  return all[0]?.worldId ?? null;
};

/**
 * Searches for a world using only the world name (no author disambiguation).
 * Returns the best match by name similarity, or null if none found.
 */
const searchByWorldNameOnly = async (
  worldName: string
): Promise<string | null> => {
  const limitedWorldData = await searchWorldsByName(worldName.trim());
  const filtered = filterWorldsWithWorldName(
    limitedWorldData,
    worldName.trim()
  );
  return filtered.length > 0 ? filtered[0].id : null;
};

export const parseWorldInfoFromPlainText = async (
  twitterLink: string,
  tweetContent: string
) => {
  logger.info('Attempting to extract World and Author Name');

  // Try custom matcher first
  const customMatch = extractWithCustomMatcher(twitterLink, tweetContent);

  let worldName = null;
  let authorName = null;

  if (customMatch) {
    worldName = customMatch.worldName;
    authorName = customMatch.authorName;
  }

  // Fall back to regex extraction if custom matcher didn't work
  if (worldName === null || authorName === null) {
    const cleaned = removeLinksFromTweet(tweetContent);
    const combined = extractWorldAndAuthor(cleaned);
    if (combined) {
      worldName = worldName ?? combined.worldName;
      authorName = authorName ?? combined.authorName;
    }
  }
  if (worldName === null) {
    worldName = extractWorldName(removeLinksFromTweet(tweetContent));
  }
  if (authorName === null) {
    authorName = extractAuthorName(removeLinksFromTweet(tweetContent));
  }

  // Safeguard: do not search if only author name is available (world name required)
  if (!worldName) {
    logger.warn(
      'Could not extract world name from tweet content (author-only is not searchable):',
      tweetContent?.substring(0, 200) + '...'
    );
    return null;
  }

  // World name only - search without author disambiguation
  if (!authorName) {
    logger.info(`Extracted world name only (no author): "${worldName}"`);
    return searchByWorldNameOnly(worldName.trim());
  }

  logger.info(`Extracted - World: "${worldName}", Author: "${authorName}"`);

  const limitedWorldData = await searchWorldsByName(worldName.trim());

  // First try to filter by world name using Levenshtein distance
  const filteredByWorldName = filterWorldsWithWorldName(
    limitedWorldData,
    worldName.trim()
  );

  // If we still have multiple results, fall back to author name filtering
  let world: LimitedWorld | undefined;
  if (filteredByWorldName && filteredByWorldName.length > 1) {
    world = filterWorldsWithAuthorName(filteredByWorldName, authorName.trim());
  } else if (filteredByWorldName && filteredByWorldName.length === 1) {
    world = filteredByWorldName[0];
  } else {
    // Fall back to original author name filtering if world name filtering didn't work
    world = filterWorldsWithAuthorName(limitedWorldData, authorName.trim());
  }

  return world?.id;
};

/**
 * Filter worlds by world name using Levenshtein distance
 * @param data - Array of limited world data to search through
 * @param worldName - The world name to match against
 * @returns Worlds scoring at or above 0.5 similarity, best first
 */
export const filterWorldsWithWorldName = (
  data: LimitedWorld[],
  worldName: string
): LimitedWorld[] => {
  const threshold = 0.5;

  return data
    .map((world) => {
      const levenshteinDistance = distance(worldName, world.name);
      const maxLength = Math.max(worldName.length, world.name.length);
      return { world, score: 1 - levenshteinDistance / maxLength };
    })
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map(({ world }) => world);
};

/**
 * Retrieve a world from an array by comparing the author names
 * @param data - Array of limited world data to search through
 * @param authorName - The author name to match against
 * @returns The world with the closest matching author name, or undefined when nothing is comparable
 */
export const filterWorldsWithAuthorName = (
  data: LimitedWorld[],
  authorName: string
): LimitedWorld | undefined => {
  const candidates = data.filter((world) => world.authorName !== '');
  if (candidates.length === 0) return undefined;

  const candidateNames = candidates.map((world) => world.authorName);
  return candidates[
    candidateNames.indexOf(closest(authorName, candidateNames))
  ];
};
