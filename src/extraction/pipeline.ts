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
import { extractWorldAndAuthorWithLLM } from './llmExtractor';

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
    logger.info(
      'Regex extraction failed, falling back to LLM extraction:',
      tweetContent?.substring(0, 200) + '...'
    );

    const llmResult = await extractWorldAndAuthorWithLLM(tweetContent);
    worldName = llmResult.worldName;
    authorName = authorName ?? llmResult.authorName;

    if (!worldName) {
      logger.warn(
        'Could not extract world name from tweet content (author-only is not searchable):',
        tweetContent?.substring(0, 200) + '...'
      );
      return null;
    }
    logger.info(
      `LLM extraction succeeded - World: "${worldName}", Author: "${authorName}"`
    );
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
 * @returns Array of worlds filtered by world name similarity, or empty array if error occurs
 */
export const filterWorldsWithWorldName = (
  data: LimitedWorld[],
  worldName: string
): LimitedWorld[] => {
  try {
    // Input validation
    if (!data || !Array.isArray(data)) {
      logger.warn(
        'filterWorldsWithWorldName: Invalid data parameter - not an array'
      );
      return [];
    }

    if (!worldName || typeof worldName !== 'string') {
      logger.warn(
        'filterWorldsWithWorldName: Invalid worldName parameter - not a string'
      );
      return [];
    }

    if (data.length === 0) {
      logger.info('filterWorldsWithWorldName: Empty data array provided');
      return [];
    }

    // Check if data has the expected structure
    if (
      !data.every((item) => item && typeof item === 'object' && 'name' in item)
    ) {
      logger.warn(
        'filterWorldsWithWorldName: Data array contains invalid items - missing name property'
      );
      return [];
    }

    // Extract world names safely
    const worldNames = data
      .map((x) => {
        if (x && x.name && typeof x.name === 'string') {
          return x.name;
        }
        logger.warn(
          'filterWorldsWithWorldName: Invalid name found in data item:',
          x
        );
        return '';
      })
      .filter((name) => name !== ''); // Remove empty names

    if (worldNames.length === 0) {
      logger.warn(
        'filterWorldsWithWorldName: No valid world names found in data'
      );
      return [];
    }

    // Calculate similarity scores for all worlds
    const worldScores = data.map((world) => {
      if (world && world.name && typeof world.name === 'string') {
        try {
          const levenshteinDistance = distance(worldName, world.name);
          const maxLength = Math.max(worldName.length, world.name.length);
          const similarity = 1 - levenshteinDistance / maxLength;
          return { world, score: similarity };
        } catch (levenshteinError) {
          logger.error(
            'filterWorldsWithWorldName: Error in Levenshtein comparison:',
            levenshteinError
          );
          return { world, score: 0 };
        }
      }
      return { world, score: 0 };
    });

    // Filter worlds with similarity score above threshold (0.5 = 50% similarity)
    const threshold = 0.5;
    const filteredWorlds = worldScores
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => b.score - a.score) // Sort by similarity score (highest first)
      .map(({ world }) => world);

    logger.info(
      `filterWorldsWithWorldName: Filtered ${data.length} worlds to ${filteredWorlds.length} by world name similarity (threshold: ${threshold})`
    );

    return filteredWorlds;
  } catch (error) {
    // Catch any unexpected errors
    logger.error(
      'filterWorldsWithWorldName: Unexpected error occurred:',
      error
    );
    return [];
  }
};

/**
 * Retrieve a world from an array by comparing the author names
 * @param data - Array of limited world data to search through
 * @param authorName - The author name to match against
 * @returns The world with the closest matching author name, or undefined if error occurs
 */
export const filterWorldsWithAuthorName = (
  data: LimitedWorld[],
  authorName: string
): LimitedWorld | undefined => {
  try {
    // Input validation
    if (!data || !Array.isArray(data)) {
      logger.warn(
        'filterWorldsWithAuthorName: Invalid data parameter - not an array'
      );
      return undefined;
    }

    if (!authorName || typeof authorName !== 'string') {
      logger.warn(
        'filterWorldsWithAuthorName: Invalid authorName parameter - not a string'
      );
      return undefined;
    }

    if (data.length === 0) {
      logger.info('filterWorldsWithAuthorName: Empty data array provided');
      return undefined;
    }

    // Check if data has the expected structure
    if (
      !data.every(
        (item) => item && typeof item === 'object' && 'authorName' in item
      )
    ) {
      logger.warn(
        'filterWorldsWithAuthorName: Data array contains invalid items - missing authorName property'
      );
      return undefined;
    }

    // Extract author names safely
    const authorNames = data
      .map((x) => {
        if (x && x.authorName && typeof x.authorName === 'string') {
          return x.authorName;
        }
        logger.warn(
          'filterWorldsWithAuthorName: Invalid authorName found in data item:',
          x
        );
        return '';
      })
      .filter((name) => name !== ''); // Remove empty names

    if (authorNames.length === 0) {
      logger.warn(
        'filterWorldsWithAuthorName: No valid author names found in data'
      );
      return undefined;
    }

    // Find closest author name using Levenshtein distance
    let closestName: string;
    try {
      closestName = closest(authorName, authorNames);
    } catch (levenshteinError) {
      logger.error(
        'filterWorldsWithAuthorName: Error in Levenshtein comparison:',
        levenshteinError
      );
      // Fallback: return first item if Levenshtein fails
      return data[0];
    }

    if (!closestName) {
      logger.warn(
        'filterWorldsWithAuthorName: Levenshtein comparison returned no result'
      );
      return data[0]; // Fallback to first item
    }

    // Find the index of the closest name
    const indexOfClosestName = authorNames.indexOf(closestName);

    if (indexOfClosestName === -1) {
      logger.warn(
        'filterWorldsWithAuthorName: Could not find closest name in authorNames array'
      );
      return data[0]; // Fallback to first item
    }

    // Return the world data for the closest matching author
    const result = data[indexOfClosestName];

    if (!result) {
      logger.warn(
        'filterWorldsWithAuthorName: No result found at calculated index'
      );
      return data[0]; // Fallback to first item
    }

    logger.info(
      `filterWorldsWithAuthorName: Successfully matched author "${authorName}" to "${closestName}"`
    );
    return result;
  } catch (error) {
    // Catch any unexpected errors
    logger.error(
      'filterWorldsWithAuthorName: Unexpected error occurred:',
      error
    );

    // Return first item as fallback if available, otherwise undefined
    if (data && Array.isArray(data) && data.length > 0) {
      logger.info(
        'filterWorldsWithAuthorName: Returning first item as fallback due to error'
      );
      return data[0];
    }

    return undefined;
  }
};
