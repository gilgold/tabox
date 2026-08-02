// AI proxy: the extension never ships or sees the OpenRouter API key — it
// lives only in the OPENROUTER_API_KEY Worker secret. The model and output
// budget are pinned server-side so a signed-in caller can't turn this into a
// general-purpose LLM proxy; the request surface is limited to exactly what
// the Tabox AI clients send (messages + sampling params + a JSON schema).
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4-flash';
const MAX_OUTPUT_TOKENS = 8192;
const PROVIDER_PREFERENCES = { sort: 'throughput', require_parameters: true };
const MAX_MESSAGES = 8;
// Total prompt budget per request. Generous for the biggest legit prompt
// (auto-arrange over a large library) while still bounding per-call spend.
const MAX_CONTENT_CHARS = 300_000;

// Validates and re-builds the upstream request from an allowlist of fields —
// nothing from the client body is forwarded as-is.
export function validateAIRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const { messages, temperature, top_k: topK, response_format: responseFormat } = body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return { ok: false, error: 'invalid_messages' };
  }
  let totalChars = 0;
  for (const message of messages) {
    if (!message || (message.role !== 'system' && message.role !== 'user') || typeof message.content !== 'string') {
      return { ok: false, error: 'invalid_messages' };
    }
    totalChars += message.content.length;
  }
  if (totalChars > MAX_CONTENT_CHARS) return { ok: false, error: 'payload_too_large' };
  if (temperature !== undefined && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    return { ok: false, error: 'invalid_temperature' };
  }
  if (topK !== undefined && (!Number.isInteger(topK) || topK < 1 || topK > 100)) {
    return { ok: false, error: 'invalid_top_k' };
  }
  let schema = null;
  if (responseFormat !== undefined) {
    schema =
      responseFormat && responseFormat.type === 'json_schema' && responseFormat.json_schema
        ? responseFormat.json_schema.schema
        : null;
    if (!schema || typeof schema !== 'object') return { ok: false, error: 'invalid_response_format' };
  }

  const request = { messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  if (temperature !== undefined) request.temperature = temperature;
  if (topK !== undefined) request.top_k = topK;
  if (schema) request.response_format = { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } };
  return { ok: true, request };
}

// OpenRouter fans the pinned model out across several providers, and a
// provider can answer 200 with an empty message. Retrying re-rolls the
// provider route, so empty completions get EMPTY_RETRY_BACKOFF_MS.length
// extra attempts before surfacing 502 empty_completion. Upstream errors are
// NOT retried. The caller charged the user's rate-limit bucket once before
// calling this, so retries never consume quota.
const EMPTY_RETRY_BACKOFF_MS = [250, 750];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function completeAI(env, validated, fetchImpl = fetch, sleepImpl = defaultSleep) {
  if (!env.OPENROUTER_API_KEY) return { ok: false, status: 500, error: 'not_configured' };
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          provider: PROVIDER_PREFERENCES,
          ...validated.request,
        }),
      });
    } catch {
      return { ok: false, status: 502, error: 'upstream_error' };
    }
    if (!res.ok) {
      console.error('ai proxy: upstream error', res.status);
      return { ok: false, status: 502, error: 'upstream_error' };
    }
    const data = await res.json().catch(() => null);
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content === 'string' && content) return { ok: true, content };
    if (attempt >= EMPTY_RETRY_BACKOFF_MS.length) {
      return { ok: false, status: 502, error: 'empty_completion' };
    }
    console.warn('ai proxy: empty completion, retrying', { attempt: attempt + 1 });
    await sleepImpl(EMPTY_RETRY_BACKOFF_MS[attempt]);
  }
}
