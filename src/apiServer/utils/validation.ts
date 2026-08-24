export interface AddWorldBody {
  worldId: string;
  guildId: string;
  messageId: string;
  content: string;
  messageTimestamp?: number;
  checkDuplicate?: boolean;
}

export interface DeleteWorldBody {
  guildId: string;
}

export interface UpdateQualityBody {
  guildId: string;
  quality: 'good' | 'bad' | null;
  messageTimestamp?: number;
}

export interface UpdateTagsBody {
  guildId: string;
  sourceContent: string | null;
  tagSource?: string;
  messageTimestamp?: number;
}

export interface UpdateTagsEditBody {
  guildId: string;
  tags: string[];
}

export interface ExtractWorldsBody {
  content: string;
}

const WORLD_ID_REGEX = /^wrld_[a-f0-9-]{36}$/;
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQualityValue(value: unknown): value is 'good' | 'bad' | null {
  return value === 'good' || value === 'bad' || value === null;
}

export function isValidWorldId(value: unknown): value is string {
  return typeof value === 'string' && WORLD_ID_REGEX.test(value);
}

export function isValidSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE_REGEX.test(value);
}

export function parseAddWorldBody(body: unknown): AddWorldBody | null {
  if (!isObject(body)) return null;
  if (!isValidWorldId(body.worldId)) return null;
  if (!isNonEmptyString(body.guildId)) return null;
  if (!isValidSnowflake(body.messageId)) return null;
  if (typeof body.content !== 'string') return null;

  const messageTimestamp = body.messageTimestamp;
  if (
    messageTimestamp !== undefined &&
    (typeof messageTimestamp !== 'number' || !Number.isFinite(messageTimestamp))
  ) {
    return null;
  }

  const checkDuplicate = body.checkDuplicate;
  if (checkDuplicate !== undefined && typeof checkDuplicate !== 'boolean') {
    return null;
  }

  return {
    worldId: body.worldId,
    guildId: body.guildId,
    messageId: body.messageId,
    content: body.content,
    messageTimestamp: messageTimestamp as number | undefined,
    checkDuplicate: checkDuplicate as boolean | undefined
  };
}

export function parseGuildIdBody(body: unknown): DeleteWorldBody | null {
  if (!isObject(body)) return null;
  if (!isNonEmptyString(body.guildId)) return null;
  return { guildId: body.guildId };
}

export function parseUpdateQualityBody(
  body: unknown
): UpdateQualityBody | null {
  if (!isObject(body)) return null;
  if (!isNonEmptyString(body.guildId)) return null;
  if (!isQualityValue(body.quality)) return null;
  const messageTimestamp = body.messageTimestamp;
  if (
    messageTimestamp !== undefined &&
    (typeof messageTimestamp !== 'number' || !Number.isFinite(messageTimestamp))
  ) {
    return null;
  }
  return {
    guildId: body.guildId,
    quality: body.quality,
    messageTimestamp: messageTimestamp as number | undefined
  };
}

export function parseExtractWorldsBody(
  body: unknown
): ExtractWorldsBody | null {
  if (!isObject(body)) return null;
  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    return null;
  }
  return { content: body.content };
}

export function parseUpdateTagsBody(body: unknown): UpdateTagsBody | null {
  if (!isObject(body)) return null;
  if (!isNonEmptyString(body.guildId)) return null;
  const sourceContent = body.sourceContent;
  if (sourceContent !== null && typeof sourceContent !== 'string') return null;
  const tagSource = body.tagSource;
  if (tagSource !== undefined && typeof tagSource !== 'string') return null;
  const messageTimestamp = body.messageTimestamp;
  if (
    messageTimestamp !== undefined &&
    (typeof messageTimestamp !== 'number' || !Number.isFinite(messageTimestamp))
  ) {
    return null;
  }
  return {
    guildId: body.guildId,
    sourceContent: sourceContent as string | null,
    tagSource: tagSource as string | undefined,
    messageTimestamp: messageTimestamp as number | undefined
  };
}

export function parseUpdateTagsEditBody(
  body: unknown
): UpdateTagsEditBody | null {
  if (!isObject(body)) return null;
  if (!isNonEmptyString(body.guildId)) return null;
  if (!Array.isArray(body.tags)) return null;
  if (!body.tags.every((value) => typeof value === 'string')) return null;
  return { guildId: body.guildId, tags: body.tags as string[] };
}
