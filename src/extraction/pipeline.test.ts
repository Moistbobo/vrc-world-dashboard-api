import {
  extractAllWorldIdsFromMessage,
  extractWorldIdFromMessage,
  filterWorldsWithWorldName,
  filterWorldsWithAuthorName,
  parseWorldInfoFromPlainText
} from './pipeline';
import { searchWorldsByName } from '../vrchat/client';
import getTweetContent from './vxtwitter';
import { extractWorldAndAuthorWithLLM } from './llmExtractor';

jest.mock('../config', () => ({
  __esModule: true,
  default: {
    VRC_USERNAME: 'mock-username',
    VRC_PASSWORD: 'mock-password',
    VRC_TOTP_KEY: 'mock-totp-key',
    WORLD_NAME_MATCHERS: ['World:', 'World', 'ワールド名'],
    AUTHOR_NAME_MATCHERS: ['Author:', 'By:', 'Author', 'by']
  }
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

jest.mock('../vrchat/client', () => ({
  searchWorldsByName: jest.fn()
}));

jest.mock('./vxtwitter', () => ({
  __esModule: true,
  default: jest.fn()
}));

jest.mock('./llmExtractor', () => ({
  extractWorldAndAuthorWithLLM: jest
    .fn()
    .mockResolvedValue({ worldName: null, authorName: null })
}));

const searchWorldsByNameMock = searchWorldsByName as jest.Mock;
const getTweetContentMock = getTweetContent as jest.Mock;
const extractWorldAndAuthorWithLLMMock =
  extractWorldAndAuthorWithLLM as jest.Mock;

const WRLD = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WRLD_2 = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef';

const makeLimitedWorld = (id: string, name: string, authorName = '') => ({
  id,
  name,
  authorName,
  capacity: 20,
  imageUrl: `https://example.com/${id}.png`,
  unityPackages: [{ platform: 'standalonewindows' }]
});

describe('extractAllWorldIdsFromMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTweetContentMock.mockResolvedValue(null);
  });

  it('extracts direct world IDs without touching Twitter', async () => {
    const result = await extractAllWorldIdsFromMessage(
      `Visit ${WRLD} or ${WRLD_2} today`
    );

    expect(result).toEqual([
      { worldId: WRLD, sourceContent: `Visit ${WRLD} or ${WRLD_2} today` },
      { worldId: WRLD_2, sourceContent: `Visit ${WRLD} or ${WRLD_2} today` }
    ]);
    expect(getTweetContentMock).not.toHaveBeenCalled();
    expect(searchWorldsByNameMock).not.toHaveBeenCalled();
  });

  it('deduplicates repeated world IDs in order of first appearance', async () => {
    const result = await extractAllWorldIdsFromMessage(
      `${WRLD} then ${WRLD} again`
    );

    expect(result).toEqual([
      { worldId: WRLD, sourceContent: `${WRLD} then ${WRLD} again` }
    ]);
  });

  it('resolves a world ID from a tweet link', async () => {
    getTweetContentMock.mockResolvedValue(
      `Come visit ${WRLD} in VRChat! #VRChat`
    );

    const result = await extractAllWorldIdsFromMessage(
      'https://x.com/someuser/status/123'
    );

    expect(result).toEqual([
      {
        worldId: WRLD,
        sourceContent: 'https://x.com/someuser/status/123'
      }
    ]);
    expect(getTweetContentMock).toHaveBeenCalledWith(
      'https://x.com/someuser/status/123'
    );
  });

  it('falls back to plain-text world name search when the tweet has no ID', async () => {
    getTweetContentMock.mockResolvedValue(
      'World: Tokyo Mood by Alice\n#VRChat #VRChat_world紹介'
    );
    searchWorldsByNameMock.mockResolvedValue([
      makeLimitedWorld('wrld_tokyo', 'Tokyo Mood', 'Alice'),
      makeLimitedWorld('wrld_tokyo2', 'Tokyo Mood 2', 'Alice')
    ]);

    const result = await extractAllWorldIdsFromMessage(
      'https://twitter.com/other/status/456'
    );

    expect(result).toEqual([
      {
        worldId: 'wrld_tokyo',
        sourceContent: 'https://twitter.com/other/status/456'
      }
    ]);
    expect(searchWorldsByNameMock).toHaveBeenCalledWith('Tokyo Mood');
  });

  it('skips tweets that yield no world', async () => {
    getTweetContentMock.mockResolvedValue('just a photo, no world info');

    const result = await extractAllWorldIdsFromMessage(
      'https://x.com/none/status/789'
    );

    expect(result).toEqual([]);
  });

  it('returns empty for content with no world links', async () => {
    const result = await extractAllWorldIdsFromMessage('hello world');

    expect(result).toEqual([]);
  });
});

describe('extractWorldIdFromMessage', () => {
  it('returns the first world ID', async () => {
    const result = await extractWorldIdFromMessage(
      `first ${WRLD} second ${WRLD_2}`
    );

    expect(result).toBe(WRLD);
  });

  it('returns null when no world is found', async () => {
    const result = await extractWorldIdFromMessage('nothing here');

    expect(result).toBeNull();
  });
});

describe('filterWorldsWithWorldName', () => {
  it('returns worlds above the similarity threshold sorted by score', () => {
    const data = [
      makeLimitedWorld('wrld_exact', 'Tokyo Mood'),
      makeLimitedWorld('wrld_close', 'Tokyo Mood 2'),
      makeLimitedWorld('wrld_far', 'Beach Hangout')
    ];

    const result = filterWorldsWithWorldName(data, 'Tokyo Mood');

    expect(result[0].id).toBe('wrld_exact');
    expect(result.map((w) => w.id)).toContain('wrld_close');
    expect(result.map((w) => w.id)).not.toContain('wrld_far');
  });

  it('returns [] for empty or invalid input', () => {
    expect(filterWorldsWithWorldName([], 'Tokyo')).toEqual([]);
    expect(filterWorldsWithWorldName(null as never, 'Tokyo')).toEqual([]);
    expect(filterWorldsWithWorldName(undefined as never, 'Tokyo')).toEqual([]);
  });

  it('returns [] for empty worldName', () => {
    expect(filterWorldsWithWorldName([makeLimitedWorld('w', 'X')], '')).toEqual(
      []
    );
  });
});

describe('filterWorldsWithAuthorName', () => {
  it('returns the world whose author is closest', () => {
    const data = [
      makeLimitedWorld('wrld_alice', 'World A', 'Alice'),
      makeLimitedWorld('wrld_bob', 'World B', 'Bob')
    ];

    const result = filterWorldsWithAuthorName(data, 'Alice');

    expect(result?.id).toBe('wrld_alice');
  });

  it('returns undefined for empty input', () => {
    expect(filterWorldsWithAuthorName([], 'Alice')).toBeUndefined();
  });
});

describe('parseWorldInfoFromPlainText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTweetContentMock.mockResolvedValue(null);
    extractWorldAndAuthorWithLLMMock.mockResolvedValue({
      worldName: null,
      authorName: null
    });
  });

  it('searches by world name and author when both are present', async () => {
    searchWorldsByNameMock.mockResolvedValue([
      makeLimitedWorld('wrld_cyber', 'Cyber 2049', 'Alice'),
      makeLimitedWorld('wrld_cyber2', 'Cyber 2049', 'Bob')
    ]);

    const result = await parseWorldInfoFromPlainText(
      'https://x.com/u/1',
      'World: Cyber 2049 by Alice'
    );

    expect(result).toBe('wrld_cyber');
  });

  it('returns null when no world name is extractable', async () => {
    const result = await parseWorldInfoFromPlainText(
      'https://x.com/u/1',
      'no world name here'
    );

    expect(result).toBeNull();
    expect(searchWorldsByNameMock).not.toHaveBeenCalled();
  });

  it('falls back to the LLM extractor when regex fails, and searches with its result', async () => {
    extractWorldAndAuthorWithLLMMock.mockResolvedValue({
      worldName: 'Cyber 2049',
      authorName: 'Alice'
    });
    searchWorldsByNameMock.mockResolvedValue([
      makeLimitedWorld('wrld_cyber', 'Cyber 2049', 'Alice'),
      makeLimitedWorld('wrld_cyber2', 'Cyber 2049', 'Bob')
    ]);

    const result = await parseWorldInfoFromPlainText(
      'https://x.com/u/1',
      'no world name here'
    );

    expect(extractWorldAndAuthorWithLLMMock).toHaveBeenCalledWith(
      'no world name here'
    );
    expect(result).toBe('wrld_cyber');
  });

  it('returns null when the LLM fallback also finds no world name', async () => {
    const result = await parseWorldInfoFromPlainText(
      'https://x.com/u/1',
      'no world name here'
    );

    expect(result).toBeNull();
    expect(searchWorldsByNameMock).not.toHaveBeenCalled();
  });
});
