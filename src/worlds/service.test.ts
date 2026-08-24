import { addWorld, WorldServiceError } from './service';

const mockConfig = { DEV: false };

jest.mock('../config', () => ({
  __esModule: true,
  get default() {
    return mockConfig;
  }
}));

jest.mock('../db/worldRepository', () => ({
  getWorldRepository: jest.fn()
}));

jest.mock('../vrchat/client', () => ({
  fetchWorldData: jest.fn(),
  ensureAuthenticated: jest.fn()
}));

jest.mock('../tags/extractor', () => ({
  extractTags: jest.fn()
}));

jest.mock('./packageSizes', () => ({
  getPackageSizesInMb: jest.fn()
}));

jest.mock('../logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

import { getWorldRepository } from '../db/worldRepository';
import { fetchWorldData } from '../vrchat/client';
import { extractTags } from '../tags/extractor';
import { getPackageSizesInMb } from './packageSizes';

const asMock = <T extends (...args: any[]) => any>(fn: any) =>
  fn as jest.MockedFunction<T>;

const REQUEST = {
  worldId: 'wrld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  guildId: 'guild-1',
  messageId: '1250000000000000000',
  content: 'Tags: horror, game'
};

const WORLD_DATA = {
  name: 'Midnight Bar',
  authorName: 'VRChat',
  capacity: 40,
  imageUrl: 'https://example.com/img.png',
  unityPackages: [
    { platform: 'standalonewindows', created_at: '2024-01-01T00:00:00Z' },
    { platform: 'android', created_at: '2024-01-01T00:00:00Z' }
  ]
};

describe('addWorld', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns duplicate with existingMessageId when record exists', async () => {
    asMock(getWorldRepository).mockReturnValue({
      getByWorldAndGuild: jest.fn(() => ({
        worldId: REQUEST.worldId,
        guildId: REQUEST.guildId,
        messageId: '1240000000000000000',
        name: 'Midnight Bar',
        authorName: 'VRChat',
        capacity: 40,
        platforms: ['standalonewindows'],
        tags: ['horror'],
        imageUrl: null,
        sourceContent: null,
        vrchatData: null,
        quality: null,
        createdAt: 1717257600,
        updatedAt: 1717257600,
        internalAddDate: null
      }))
    });

    const result = await addWorld(REQUEST);

    expect(result.status).toBe('duplicate');
    if (result.status === 'duplicate') {
      expect(result.existingMessageId).toBe('1240000000000000000');
    }
    expect(fetchWorldData).not.toHaveBeenCalled();
  });

  it('fetches VRChat data, extracts tags, and upserts when new', async () => {
    asMock(getWorldRepository).mockReturnValue({
      getByWorldAndGuild: jest.fn(() => undefined),
      upsert: jest.fn()
    });
    asMock(fetchWorldData).mockResolvedValue(WORLD_DATA as never);
    asMock(extractTags).mockReturnValue(['horror', 'game']);
    asMock(getPackageSizesInMb).mockResolvedValue([104.5, 78.2]);

    const result = await addWorld(REQUEST);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.world.platforms).toEqual(['standalonewindows', 'android']);
      expect(result.world.packageSizes).toEqual([104.5, 78.2]);
      expect(result.world.tags).toEqual(['horror', 'game']);
      expect(result.world.internalAddDate).toBeDefined();
      expect(result.world.vrchatData).toBe(JSON.stringify(WORLD_DATA));
    }
    expect(getPackageSizesInMb).toHaveBeenCalledWith(WORLD_DATA);
    expect(getWorldRepository().upsert).toHaveBeenCalledTimes(1);
  });

  it('skips the duplicate check when checkDuplicate is false', async () => {
    const getByWorldAndGuild = jest.fn(() => ({
      messageId: '1240000000000000000'
    }));
    asMock(getWorldRepository).mockReturnValue({
      getByWorldAndGuild,
      upsert: jest.fn()
    });
    asMock(fetchWorldData).mockResolvedValue(WORLD_DATA as never);
    asMock(extractTags).mockReturnValue([]);
    asMock(getPackageSizesInMb).mockResolvedValue([]);

    const result = await addWorld({ ...REQUEST, checkDuplicate: false });

    expect(getByWorldAndGuild).not.toHaveBeenCalled();
    expect(result.status).toBe('created');
  });

  it('skips the duplicate check when DEV is true', async () => {
    mockConfig.DEV = true;
    const getByWorldAndGuild = jest.fn(() => ({
      messageId: '1240000000000000000'
    }));
    asMock(getWorldRepository).mockReturnValue({
      getByWorldAndGuild,
      upsert: jest.fn()
    });
    asMock(fetchWorldData).mockResolvedValue(WORLD_DATA as never);
    asMock(extractTags).mockReturnValue([]);
    asMock(getPackageSizesInMb).mockResolvedValue([]);

    const result = await addWorld(REQUEST);

    expect(getByWorldAndGuild).not.toHaveBeenCalled();
    expect(result.status).toBe('created');
  });

  it('uses the provided messageTimestamp for internalAddDate', async () => {
    asMock(getWorldRepository).mockReturnValue({
      getByWorldAndGuild: jest.fn(() => undefined),
      upsert: jest.fn()
    });
    asMock(fetchWorldData).mockResolvedValue(WORLD_DATA as never);
    asMock(extractTags).mockReturnValue([]);
    asMock(getPackageSizesInMb).mockResolvedValue([]);

    const result = await addWorld({ ...REQUEST, messageTimestamp: 1700000000 });

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.world.internalAddDate).toBe(1700000000);
    }
  });

  it('throws WorldServiceError with 502 when VRChat fetch fails', async () => {
    asMock(getWorldRepository).mockReturnValue({
      getByWorldAndGuild: jest.fn(() => undefined),
      upsert: jest.fn()
    });
    asMock(fetchWorldData).mockRejectedValue(new Error('VRC API down'));

    await expect(addWorld(REQUEST)).rejects.toThrow(WorldServiceError);
    await expect(addWorld(REQUEST)).rejects.toMatchObject({ statusCode: 502 });
  });
});
