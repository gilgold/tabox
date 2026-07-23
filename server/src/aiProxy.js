// AI proxy: the extension never ships or sees the OpenRouter API key — it
// lives only in the OPENROUTER_API_KEY Worker secret. The model and output
// budget are pinned server-side so a signed-in caller can't turn this into a
// general-purpose LLM proxy; the request surface is limited to exactly what
// the Tabox AI clients send (messages + sampling params + a JSON schema).
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4-flash';
const MAX_OUTPUT_TOKENS = 8192;
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

export async function completeAI(env, validated, fetchImpl = fetch) {
  if (!env.OPENROUTER_API_KEY) return { ok: false, status: 500, error: 'not_configured' };
  let res;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, ...validated.request }),
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
  if (typeof content !== 'string' || !content) return { ok: false, status: 502, error: 'empty_completion' };
  return { ok: true, content };
}
