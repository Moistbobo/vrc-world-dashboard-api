import { extractWorldAndAuthorWithLLM } from './llmExtractor';

jest.mock('../config', () => ({
  __esModule: true,
  default: {
    WORLD_NAME_MATCHERS: ['World:', 'ワールド名'],
    AUTHOR_NAME_MATCHERS: ['By:', '作者様'],
    LLM_EXTRACTOR_URL: 'http://127.0.0.1:4000',
    LLM_EXTRACTOR_TIMEOUT_MS: 1000
  }
}));

const config = jest.requireMock('../config').default as {
  LLM_EXTRACTOR_URL: string;
  WORLD_NAME_MATCHERS: string[];
  AUTHOR_NAME_MATCHERS: string[];
};

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Gateway',
    json: jest.fn().mockResolvedValue(body)
  }) as unknown as Response;

beforeEach(() => {
  fetchMock.mockReset();
  config.LLM_EXTRACTOR_URL = 'http://127.0.0.1:4000';
});

describe('extractWorldAndAuthorWithLLM', () => {
  it('returns nulls without calling the service when unconfigured', async () => {
    config.LLM_EXTRACTOR_URL = '';

    const result = await extractWorldAndAuthorWithLLM('some tweet');

    expect(result).toEqual({ worldName: null, authorName: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts content and matcher terms to the extractor endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ worldName: 'Tokyo Mood', authorName: 'BEAMS_STAFF_1' })
    );

    const result = await extractWorldAndAuthorWithLLM('some tweet');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4000/extract');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'some tweet',
      terms: {
        worldTerms: ['World:', 'ワールド名'],
        authorTerms: ['By:', '作者様']
      }
    });
    expect(result).toEqual({
      worldName: 'Tokyo Mood',
      authorName: 'BEAMS_STAFF_1'
    });
  });

  it('returns nulls when the service responds non-OK', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 503));

    const result = await extractWorldAndAuthorWithLLM('some tweet');

    expect(result).toEqual({ worldName: null, authorName: null });
  });

  it('returns nulls on an unexpected response shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ foo: 'bar' }));

    const result = await extractWorldAndAuthorWithLLM('some tweet');

    expect(result).toEqual({ worldName: null, authorName: null });
  });

  it('returns nulls when the service call throws', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const result = await extractWorldAndAuthorWithLLM('some tweet');

    expect(result).toEqual({ worldName: null, authorName: null });
  });
});
