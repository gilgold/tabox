import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { validateAIRequest, completeAI } from '../src/aiProxy.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? String(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = v; }),
});
const env = (kvStore = {}, extra = {}) => ({
  GOOGLE_CLIENT_ID: 'cid',
  JWT_SECRET: 's',
  ENTITLEMENTS: makeKV(kvStore),
  OPENROUTER_API_KEY: 'sk-or-secret',
  ...extra,
});

// authenticate() calls Google tokeninfo then drive/about; anything hitting
// openrouter.ai is the upstream completion call.
function mockFetch({ identities = { 't-user': { googleId: 'g-user', email: 'u@x.com' } }, completion = '{"name":"X"}', upstreamOk = true } = {}) {
  const calls = { openrouter: [] };
  globalThis.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.includes('openrouter.ai')) {
      calls.openrouter.push({ url: u, opts });
      if (!upstreamOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: completion } }] }) };
    }
    const token = u.includes('tokeninfo')
      ? new URL(u).searchParams.get('access_token')
      : (opts?.headers?.Authorization || '').replace('Bearer ', '');
    const id = identities[token];
    if (!id) return { ok: false };
    if (u.includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
    return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
  });
  return calls;
}

const req = (token, body) => new Request('https://api/ai/complete', {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});

const VALID_BODY = {
  messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }],
  temperature: 0,
  response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: { type: 'object' } } },
};

describe('POST /ai/complete', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects unauthenticated callers', async () => {
    mockFetch();
    const res = await worker.fetch(req('t-bad', VALID_BODY), env());
    expect(res.status).toBe(401);
  });

  it('proxies a valid request with the pinned model and server-held key', async () => {
    const calls = mockFetch({ completion: '{"name":"Research"}' });
    const res = await worker.fetch(req('t-user', VALID_BODY), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: '{"name":"Research"}' });
    expect(calls.openrouter).toHaveLength(1);
    const upstream = JSON.parse(calls.openrouter[0].opts.body);
    expect(upstream.model).toBe('deepseek/deepseek-v4-flash');
    expect(upstream.max_tokens).toBe(8192);
    expect(upstream.temperature).toBe(0);
    expect(upstream.messages).toEqual(VALID_BODY.messages);
    expect(upstream.response_format.json_schema.schema).toEqual({ type: 'object' });
    expect(calls.openrouter[0].opts.headers.Authorization).toBe('Bearer sk-or-secret');
  });

  it('a client-supplied model is ignored — the server pin always wins', async () => {
    const calls = mockFetch();
    const res = await worker.fetch(req('t-user', { ...VALID_BODY, model: 'openai/o5-pro' }), env());
    expect(res.status).toBe(200);
    expect(JSON.parse(calls.openrouter[0].opts.body).model).toBe('deepseek/deepseek-v4-flash');
  });

  it('rejects malformed bodies without calling upstream', async () => {
    const calls = mockFetch();
    for (const bad of [
      {},
      { messages: [] },
      { messages: [{ role: 'assistant', content: 'x' }] },
      { messages: [{ role: 'user', content: 'x' }], temperature: 9 },
      { messages: [{ role: 'user', content: 'x' }], top_k: 0 },
      { messages: [{ role: 'user', content: 'x' }], response_format: { type: 'text' } },
    ]) {
      const res = await worker.fetch(req('t-user', bad), env());
      expect(res.status).toBe(400);
    }
    expect(calls.openrouter).toHaveLength(0);
  });

  it('rejects oversized prompts with 413', async () => {
    mockFetch();
    const res = await worker.fetch(
      req('t-user', { messages: [{ role: 'user', content: 'x'.repeat(300_001) }] }),
      env(),
    );
    expect(res.status).toBe(413);
  });

  it('rate-limits per user (burst bucket)', async () => {
    mockFetch();
    const e = env();
    let lastStatus = 200;
    for (let i = 0; i < 21; i++) {
      lastStatus = (await worker.fetch(req('t-user', VALID_BODY), e)).status;
    }
    expect(lastStatus).toBe(429);
  });

  it('maps upstream failures to 502 without leaking detail', async () => {
    mockFetch({ upstreamOk: false });
    const res = await worker.fetch(req('t-user', VALID_BODY), env());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
  });

  it('returns 500 not_configured when the secret is missing', async () => {
    mockFetch();
    const res = await worker.fetch(req('t-user', VALID_BODY), env({}, { OPENROUTER_API_KEY: undefined }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'not_configured' });
  });
});

describe('validateAIRequest', () => {
  it('strips unknown message fields and unknown top-level fields', () => {
    const out = validateAIRequest({
      messages: [{ role: 'user', content: 'hi', name: 'attacker' }],
      max_tokens: 999999,
      model: 'openai/o5-pro',
    });
    expect(out.ok).toBe(true);
    expect(out.request).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });
});

// Bursts of empty completions come from OpenRouter's multi-provider routing:
// a provider can 200 with empty content, and parallel requests all routed to
// it fail together. completeAI retries (re-rolling the provider route) before
// surfacing empty_completion; the rate limit was already charged once at the
// route layer, so retries never touch the user's quota.
describe('completeAI empty-completion retry', () => {
  const E = { OPENROUTER_API_KEY: 'sk-or-secret' };
  const VALIDATED = { ok: true, request: { messages: [{ role: 'user', content: 'hi' }] } };
  const resp = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

  it('retries an empty completion and succeeds on the second attempt', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(resp(''))
      .mockResolvedValueOnce(resp('{"name":"X"}'));
    const sleepImpl = vi.fn(async () => {});
    const result = await completeAI(E, VALIDATED, fetchImpl, sleepImpl);
    expect(result).toEqual({ ok: true, content: '{"name":"X"}' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after three empty attempts with 502 empty_completion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(''));
    const sleepImpl = vi.fn(async () => {});
    const result = await completeAI(E, VALIDATED, fetchImpl, sleepImpl);
    expect(result).toEqual({ ok: false, status: 502, error: 'empty_completion' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry upstream errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const sleepImpl = vi.fn(async () => {});
    const result = await completeAI(E, VALIDATED, fetchImpl, sleepImpl);
    expect(result).toEqual({ ok: false, status: 502, error: 'upstream_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('does not sleep when the first attempt succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp('ok'));
    const sleepImpl = vi.fn(async () => {});
    const result = await completeAI(E, VALIDATED, fetchImpl, sleepImpl);
    expect(result).toEqual({ ok: true, content: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
