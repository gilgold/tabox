// chrome/ai-client.js — SW-side client for the Worker's /ai/complete proxy.
// background-utils (getAuthToken) and pro-config (PRO_API_BASE) are mocked so
// the module wires against a fake worker origin.
jest.mock('../chrome/background-utils', () => ({
  getAuthToken: jest.fn(),
}));
jest.mock('../chrome/pro-config', () => ({
  PRO_API_BASE: 'https://worker.test',
}));

const { getAuthToken } = require('../chrome/background-utils');

function mockFetch({ body = { content: '{"name":"Reading"}' }, ok = true, status = 200 } = {}) {
  return jest.fn(async () => ({ ok, status, json: async () => body }));
}

// The client keeps no module-level state (tokens are fetched per call), so a
// single require is fine.
const loadClient = () => require('../chrome/ai-client.js');

describe('ai-client module (SW → Worker proxy)', () => {
  beforeEach(() => {
    getAuthToken.mockReset();
    getAuthToken.mockResolvedValue('g-token');
  });

  afterEach(() => { delete global.fetch; });

  test('aiAvailability returns "available" when signed in', async () => {
    const { aiAvailability } = loadClient();
    expect(await aiAvailability()).toBe('available');
  });

  test('aiAvailability returns "sign-in-required" when signed out or token fetch fails', async () => {
    const { aiAvailability } = loadClient();
    getAuthToken.mockResolvedValue(null);
    expect(await aiAvailability()).toBe('sign-in-required');
    getAuthToken.mockRejectedValue(new Error('no session'));
    expect(await aiAvailability()).toBe('sign-in-required');
  });

  test('prompt posts to the Worker proxy with the Google token — no model, no API key', async () => {
    global.fetch = mockFetch();
    const { createAISession } = loadClient();
    const session = await createAISession({ systemPrompt: 'sys', temperature: 0.7, topK: 3 });
    await session.prompt('hello');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://worker.test/ai/complete');
    expect(opts.headers.Authorization).toBe('Bearer g-token');
    const body = JSON.parse(opts.body);
    expect(body.model).toBeUndefined();
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]);
    expect(body.temperature).toBe(0.7);
    expect(body.top_k).toBe(3);
    expect(JSON.stringify(body)).not.toContain('sk-or');
  });

  test('promptForJSON sends the schema as response_format and parses the reply', async () => {
    global.fetch = mockFetch({ body: { content: '{"name":"Reading"}' } });
    const { createAISession, promptForJSON } = loadClient();
    const session = await createAISession({});
    const out = await promptForJSON(session, 'p', { type: 'object' });
    expect(out).toEqual({ name: 'Reading' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema: { type: 'object' } },
    });
  });

  test('promptForJSON parses a fenced JSON reply', async () => {
    global.fetch = mockFetch({ body: { content: '```json\n{"name":"X"}\n```' } });
    const { createAISession, promptForJSON } = loadClient();
    const session = await createAISession({});
    expect(await promptForJSON(session, 'p', { type: 'object' })).toEqual({ name: 'X' });
  });

  test('prompt throws a sign-in error when there is no token', async () => {
    global.fetch = mockFetch();
    const { createAISession } = loadClient();
    const session = await createAISession({});
    getAuthToken.mockResolvedValue(null);
    await expect(session.prompt('hello')).rejects.toThrow(/sign in/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('prompt surfaces the Worker error code on a failed response', async () => {
    global.fetch = mockFetch({ ok: false, status: 429, body: { error: 'rate_limited' } });
    const { createAISession } = loadClient();
    const session = await createAISession({});
    await expect(session.prompt('hello')).rejects.toThrow(/429.*rate_limited/);
  });

  test('a hung request rejects with TimeoutError instead of hanging forever', async () => {
    jest.useFakeTimers();
    try {
      // fetch that never settles until aborted — like a stalled upstream.
      global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }));
      const { createAISession } = loadClient();
      const session = await createAISession({});
      const pending = session.prompt('hello').then(() => null, (e) => e);
      await jest.advanceTimersByTimeAsync(120000);
      const err = await pending;
      expect(err).toMatchObject({ name: 'TimeoutError' });
    } finally {
      jest.useRealTimers();
    }
  });

  test('a caller abort rejects with AbortError (not TimeoutError)', async () => {
    global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; return reject(e); }
      signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }));
    const { createAISession } = loadClient();
    const controller = new AbortController();
    const session = await createAISession({ signal: controller.signal });
    const pending = session.prompt('hello').then(() => null, (e) => e);
    controller.abort();
    const err = await pending;
    expect(err).toMatchObject({ name: 'AbortError' });
  });

  test('clone returns an independent session; destroy is a no-op', async () => {
    global.fetch = mockFetch();
    const { createAISession } = loadClient();
    const session = await createAISession({ systemPrompt: 'sys' });
    const clone = await session.clone();
    expect(clone).not.toBe(session);
    expect(() => session.destroy()).not.toThrow();
  });
});
