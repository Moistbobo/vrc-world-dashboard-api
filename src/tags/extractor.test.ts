import { extractTags } from './extractor';

jest.mock('../logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('extractTags', () => {
  it('extracts from a structured "Tags:" line', () => {
    expect(extractTags('Tags: horror, game')).toEqual(['horror', 'game']);
  });

  it('supports full-width colon', () => {
    expect(extractTags('タグ：ホラー')).toEqual([]);
  });

  it('extracts the flying tag', () => {
    expect(extractTags('Tags: flying')).toEqual(['flying']);
  });

  it('canonicalizes variant spellings', () => {
    expect(extractTags('Tags: vrmv')).toEqual(['particle live / vrmv']);
  });

  it('accepts unstructured lines with majority valid tokens', () => {
    expect(extractTags('https://example.com kino chill')).toEqual([
      'kino',
      'chill'
    ]);
  });

  it('rejects unstructured lines without enough valid tokens', () => {
    expect(extractTags('https://example.com totally random words')).toEqual([]);
  });

  it('returns empty array for empty content', () => {
    expect(extractTags('')).toEqual([]);
    expect(extractTags('   ')).toEqual([]);
  });

  it('deduplicates tags', () => {
    expect(extractTags('Tags: horror, horror')).toEqual(['horror']);
  });
});
