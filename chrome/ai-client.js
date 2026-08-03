/* eslint-disable no-undef */
// chrome/ai-client.js
// Service-worker AI client. All inference goes through the Tabox Worker's
// POST /ai/complete proxy (OpenRouter, DeepSeek V4 Flash) so the OpenRouter
// API key never ships in the extension — the Worker holds it as a secret and
// authenticates callers by their Google token. The popup's app/ai/aiClient.js
// relays through here via the `aiComplete` message; keep the session/prompt
// interface of the two in sync.
//
// Loaded via importScripts in background.js after background-utils.js
// (getAuthToken) and pro-config.js (PRO_API_BASE); the require/globalThis
// guards let Jest pull it in directly (mirrors chrome/shared-folders.js).
(() => {
const aiClientBgUtils = typeof require === 'function'
    ? require('./background-utils')
    : globalThis.TaboxBackgroundUtils;
const AI_API_BASE = typeof require === 'function'
    ? require('./pro-config').PRO_API_BASE
    : PRO_API_BASE;

// Returns: 'available' | 'sign-in-required'
async function aiAvailability() {
    try {
        const token = await aiClientBgUtils.getAuthTokenForAI();
        return token ? 'available' : 'sign-in-required';
    } catch {
        return 'sign-in-required';
    }
}

// Sessions are stateless request builders: each prompt sends only the system
// prompt + that prompt (no accumulated context), so repeated prompts on one
// session don't get slower or costlier over a long run.
async function createAISession({ systemPrompt, temperature, topK, signal } = {}) {
    // Prefetch/refresh the auth token so the first prompt doesn't pay for it.
    aiClientBgUtils.getAuthTokenForAI().catch(() => {});
    return {
        prompt: (text, options = {}) => requestCompletion(
            { systemPrompt, temperature, topK },
            text,
            { ...options, signal: options.signal || signal },
        ),
        clone: () => createAISession({ systemPrompt, temperature, topK, signal }),
        destroy: () => {},
    };
}

async function promptForJSON(session, prompt, schema, signal) {
    const options = { responseConstraint: schema };
    if (signal) options.signal = signal;
    const startedAt = Date.now();
    const raw = await session.prompt(prompt, options);
    console.debug(`Tabox AI: inference ${Date.now() - startedAt}ms`);
    return parseJSONContent(raw);
}

// Hard per-request deadline. Without one, a stalled upstream (Worker or
// OpenRouter) hangs its fetch forever and freezes the whole task's progress —
// tasks can only observe failures between requests. A timeout turns the hang
// into a normal per-item error (rename skip / split Misc sweep). Generous vs
// observed inference times (a few seconds) so it never clips a slow-but-live
// completion.
const AI_REQUEST_TIMEOUT_MS = 90_000;

async function requestCompletion(config, text, { responseConstraint, signal } = {}) {
    const token = await aiClientBgUtils.getAuthTokenForAI();
    if (!token) throw new Error('Tabox AI: sign in to Tabox to use AI features');
    // One internal controller drives the fetch; the caller's signal and the
    // deadline both funnel into it. Manual wiring (no AbortSignal.timeout/any —
    // Chrome 89 baseline). `timedOut` disambiguates the two abort sources so a
    // deadline surfaces as TimeoutError (per-item failure), never as AbortError
    // (which tasks treat as cancellation).
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, AI_REQUEST_TIMEOUT_MS);
    const messages = [];
    if (config.systemPrompt) messages.push({ role: 'system', content: config.systemPrompt });
    messages.push({ role: 'user', content: text });
    const body = { messages };
    if (config.temperature !== undefined) body.temperature = config.temperature;
    if (config.topK !== undefined) body.top_k = config.topK;
    if (responseConstraint) {
        body.response_format = {
            type: 'json_schema',
            json_schema: { name: 'response', strict: true, schema: responseConstraint },
        };
    }
    let response;
    try {
        response = await fetch(`${AI_API_BASE}/ai/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        if (timedOut) {
            const e = new Error(`Tabox AI: request timed out after ${AI_REQUEST_TIMEOUT_MS / 1000}s`);
            e.name = 'TimeoutError';
            throw e;
        }
        throw err;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 403 && data.error === 'pro_required') {
            // The Worker says entitlement is gone (expired trial, cancellation)
            // while the popup's cached record may still say Pro for up to 24h.
            // Refresh the cache in the background: the storage.local write flips
            // isPro in any open popup (usePremiumEntitlement's onChanged
            // listener), swapping the tool panel for the upsell. Fire-and-forget
            // so a slow refresh can't delay the error surfacing.
            try { Promise.resolve(globalThis.refreshProEntitlement?.()).catch(() => {}); } catch { /* no-op */ }
            const proError = new Error('Tabox AI requires Tabox Pro. Upgrade to keep using AI tools.');
            proError.code = 'pro_required';
            throw proError;
        }
        throw new Error(`Tabox AI: request failed (${response.status}): ${data.error || 'request_failed'}`);
    }
    if (typeof data.content !== 'string' || !data.content) throw new Error('Tabox AI: empty completion');
    return data.content;
}

// Models occasionally wrap JSON in a markdown fence even under json_schema.
function parseJSONContent(raw) {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return JSON.parse(fenced ? fenced[1] : trimmed);
}

const aiClientApi = { aiAvailability, createAISession, promptForJSON };

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIClient = aiClientApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = aiClientApi;
})();
