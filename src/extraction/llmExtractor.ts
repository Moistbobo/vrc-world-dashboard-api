import Config from '../config';
import logger from '../logger';

export interface LlmExtractionResult {
  worldName: string | null;
  authorName: string | null;
}

const EMPTY_RESULT: LlmExtractionResult = {
  worldName: null,
  authorName: null
};

function isExtractionResult(data: unknown): data is LlmExtractionResult {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return (
    (record.worldName === null || typeof record.worldName === 'string') &&
    (record.authorName === null || typeof record.authorName === 'string')
  );
}

/**
 * Extracts world/author names via the LLM extractor microservice.
 * Returns nulls when unconfigured, on error, or on timeout — never throws,
 * so callers can fall back to their existing behavior.
 */
export async function extractWorldAndAuthorWithLLM(
  content: string
): Promise<LlmExtractionResult> {
  if (!Config.LLM_EXTRACTOR_URL) {
    return EMPTY_RESULT;
  }

  const url = `${Config.LLM_EXTRACTOR_URL.replace(/\/+$/, '')}/extract`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        terms: {
          worldTerms: Config.WORLD_NAME_MATCHERS,
          authorTerms: Config.AUTHOR_NAME_MATCHERS
        }
      }),
      signal: AbortSignal.timeout(Config.LLM_EXTRACTOR_TIMEOUT_MS)
    });

    if (!response.ok) {
      logger.warn(
        `LLM extractor responded ${response.status}: ${response.statusText}`
      );
      return EMPTY_RESULT;
    }

    const data: unknown = await response.json();
    if (!isExtractionResult(data)) {
      logger.warn('LLM extractor returned an unexpected response shape');
      return EMPTY_RESULT;
    }
    return data;
  } catch (error) {
    logger.warn('LLM extraction failed, skipping fallback:', error);
    return EMPTY_RESULT;
  }
}
