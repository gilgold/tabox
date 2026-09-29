// AI proxy: the extension never ships or sees the OpenRouter API key — it
// lives only in the OPENROUTER_API_KEY Worker secret. The model and output
// budget are pinned server-side, and abuse is bounded by the caller-side
// checks in the route handler plus the limits here: signed-in Pro users only,
// rate limits (20/min, 500/day), a 300k-char total prompt budget, and at most
// 32 system/user/assistant messages (multi-turn support added for the Task
// Planner chat). The request surface is rebuilt from an allowlist of fields —
// nothing from the client body is forwarded as-is.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Model TIERS are pinned server-side; the client can only pick a tier name
// (model_tier), never a model string. 'thinking' runs a reasoning pass before
// answering — used by the Task Planner chat to decompose a request into its
// facets (hotels, tickets, flights, …) — and gets a larger output budget
// because reasoning tokens count against max_tokens.
const MODEL_TIERS = {
  default: { model: 'google/gemini-3.5-flash-lite', maxTokens: 8192 },
  thinking: {
    model: 'google/gemini-3.8-flash',
    maxTokens: 16384,
    reasoning: { effort: 'medium' },
  },
};
const PROVIDER_PREFERENCES = { sort: 'throughput', require_parameters: true };
// Mirrored client-side as MAX_CHAT_MESSAGES in chrome/ai-client.js — keep in sync.
const MAX_MESSAGES = 32;
// Total prompt budget per request. Generous for the biggest legit prompt
// (auto-arrange over a large library) while still bounding per-call spend.
const MAX_CONTENT_CHARS = 300_000;

// Validates and re-builds the upstream request from an allowlist of fields —
// nothing from the client body is forwarded as-is.
export function validateAIRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const { messages, temperature, top_k: topK, response_format: responseFormat, model_tier: modelTier } = body;
  if (modelTier !== undefined && !Object.prototype.hasOwnProperty.call(MODEL_TIERS, modelTier)) {
    return { ok: false, error: 'invalid_model_tier' };
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return { ok: false, error: 'invalid_messages' };
  }
  let totalChars = 0;
  for (const message of messages) {
    if (!message || (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
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
  // top_k is validated but never forwarded: the pinned Gemini endpoints don't
  // advertise it, so under require_parameters it routes to zero endpoints
  // (OpenRouter 404). Older extension builds still send it.
  if (schema) request.response_format = { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } };
  // The tier rides OUTSIDE request: completeAI resolves it to pinned
  // model/max_tokens/reasoning; the raw field is never forwarded upstream.
  return { ok: true, request, tier: modelTier || 'default' };
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
  const tier = MODEL_TIERS[validated.tier] || MODEL_TIERS.default;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://tabox.co',
          'X-Title': 'Tabox',
        },
        body: JSON.stringify({
          model: tier.model,
          max_tokens: tier.maxTokens,
          provider: PROVIDER_PREFERENCES,
          // Reasoning happens server-side of the content: the JSON answer stays
          // in message.content, so response handling is tier-agnostic.
          ...(tier.reasoning ? { reasoning: tier.reasoning } : {}),
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
