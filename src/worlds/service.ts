import { World } from 'vrchat';
import { fetchWorldData } from '../vrchat/client';
import { getPackageSizesInMb } from './packageSizes';
import { extractTags } from '../tags/extractor';
import {
  getDiscordMessageTimestampSeconds,
  getSupportedPlatforms
} from './helpers';
import { getWorldRepository, type WorldRecord } from '../db/worldRepository';
import Config from '../config';

export interface AddWorldRequest {
  worldId: string;
  guildId: string;
  messageId: string;
  content: string;
  messageTimestamp?: number;
  checkDuplicate?: boolean;
}

export type AddWorldResult =
  | { status: 'created'; world: WorldRecord }
  | { status: 'duplicate'; world: WorldRecord; existingMessageId: string };

export type WorldServiceErrorKind =
  'worldNotFound' | 'vrchatFetchFailed' | 'invalidRequest';

export class WorldServiceError extends Error {
  readonly kind: WorldServiceErrorKind;
  readonly statusCode: number;

  constructor(
    kind: WorldServiceErrorKind,
    message: string,
    statusCode: number
  ) {
    super(message);
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

function buildWorldRecord(
  worldId: string,
  guildId: string,
  messageId: string,
  content: string,
  worldData: World,
  packageSizes: (number | null)[],
  messageTimestamp?: number
): WorldRecord {
  return {
    worldId,
    guildId,
    messageId,
    name: worldData.name,
    authorName: worldData.authorName,
    capacity: worldData.capacity,
    platforms: getSupportedPlatforms(worldData.unityPackages ?? []),
    tags: extractTags(content),
    imageUrl: worldData.imageUrl,
    sourceContent: content,
    vrchatData: JSON.stringify(worldData, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ),
    packageSizes,
    internalAddDate:
      messageTimestamp ?? getDiscordMessageTimestampSeconds(messageId)
  };
}

export async function addWorld(req: AddWorldRequest): Promise<AddWorldResult> {
  const repo = getWorldRepository();
  const checkDuplicate = Config.DEV ? false : (req.checkDuplicate ?? true);

  if (checkDuplicate) {
    const existing = await repo.getByWorldAndGuild(req.worldId, req.guildId);
    if (existing) {
      if (req.messageTimestamp !== undefined) {
        await repo.backfillInternalAddDate(
          req.worldId,
          req.guildId,
          req.messageTimestamp
        );
      }
      return {
        status: 'duplicate',
        world: existing,
        existingMessageId: existing.messageId
      };
    }
  }

  let worldData: World;
  try {
    worldData = await fetchWorldData(req.worldId);
  } catch {
    throw new WorldServiceError(
      'vrchatFetchFailed',
      'Failed to fetch world data from VRChat',
      502
    );
  }

  const packageSizes = await getPackageSizesInMb(worldData);

  const record = buildWorldRecord(
    req.worldId,
    req.guildId,
    req.messageId,
    req.content,
    worldData,
    packageSizes,
    req.messageTimestamp
  );
  await repo.upsert(record);

  return { status: 'created', world: record };
}
