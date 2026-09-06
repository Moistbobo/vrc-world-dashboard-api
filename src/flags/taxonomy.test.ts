import { FLAG_SEED } from '../db/flagSeed';
import { clearFlagTaxonomy, setFlagTaxonomy, validateFlags } from './taxonomy';

describe('validateFlags', () => {
  beforeEach(() => {
    setFlagTaxonomy(FLAG_SEED);
  });

  afterEach(() => {
    clearFlagTaxonomy();
  });

  it('returns empty valid and invalid for an empty array', () => {
    expect(validateFlags([])).toEqual({ valid: [], invalid: [] });
  });

  it('canonicalizes case and whitespace variants to the catalog form', () => {
    expect(validateFlags(['  Furry ', 'AI SLOP', ' Low Quality '])).toEqual({
      valid: ['furry', 'AI slop', 'low quality'],
      invalid: []
    });
  });

  it('dedupes preserving first-occurrence order', () => {
    expect(validateFlags(['furry', 'Furry', 'ai slop'])).toEqual({
      valid: ['furry', 'AI slop'],
      invalid: []
    });
  });

  it('reports flags outside the catalog as invalid', () => {
    expect(validateFlags(['furry', 'made up flag'])).toEqual({
      valid: ['furry'],
      invalid: ['made up flag']
    });
  });
});

describe('unloaded flag taxonomy', () => {
  beforeEach(() => {
    clearFlagTaxonomy();
  });

  afterEach(() => {
    setFlagTaxonomy(FLAG_SEED);
  });

  it('throws when the taxonomy has not been loaded', () => {
    expect(() => validateFlags(['furry'])).toThrow(/Flag taxonomy not loaded/);
  });
});
