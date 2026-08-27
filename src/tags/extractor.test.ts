import {
  extractTags,
  validateTags,
  setTaxonomy,
  clearTaxonomy
} from './extractor';
import { TAG_SEED } from '../db/tagSeed';

jest.mock('../logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

beforeAll(() => {
  setTaxonomy(TAG_SEED.map((t) => t.tag));
});

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

describe('validateTags', () => {
  it('canonicalizes variant spellings', () => {
    expect(validateTags(['vrmv'])).toEqual({
      valid: ['particle live / vrmv'],
      invalid: []
    });
  });

  it('normalizes case and whitespace', () => {
    expect(validateTags(['  HORROR ', 'Game'])).toEqual({
      valid: ['horror', 'game'],
      invalid: []
    });
  });

  it('deduplicates valid tags', () => {
    expect(validateTags(['horror', 'HORROR', 'horror'])).toEqual({
      valid: ['horror'],
      invalid: []
    });
  });

  it('rejects unknown tags into invalid preserving the original value', () => {
    expect(validateTags(['nope', 'horror', 'NOPE2'])).toEqual({
      valid: ['horror'],
      invalid: ['nope', 'NOPE2']
    });
  });

  it('returns empty valid and invalid for an empty array', () => {
    expect(validateTags([])).toEqual({ valid: [], invalid: [] });
  });
});

describe('unloaded taxonomy', () => {
  afterAll(() => {
    setTaxonomy(TAG_SEED.map((t) => t.tag));
  });

  it('throws when the taxonomy has not been loaded', () => {
    clearTaxonomy();
    expect(() => extractTags('Tags: horror')).toThrow(/Taxonomy not loaded/);
    expect(() => validateTags(['horror'])).toThrow(/Taxonomy not loaded/);
  });
});
