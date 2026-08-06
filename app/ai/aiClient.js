// Thin popup-side AI wrapper. Inference runs in the service worker
// (`aiComplete` message → chrome/ai-client.js → the Tabox Worker's
// /ai/complete proxy → OpenRouter DeepSeek V4 Flash), so the popup never
// handles auth tokens and the OpenRouter API key never ships in the
// extension. Every Tabox AI feature goes through this module so the
// underlying provider or execution context can change without touching
// feature code. Keep the session/prompt interface in sync with
// chrome/ai-client.js.
import { browser } from '../../static/globals';

export function isAISupported() {
    // Cloud inference works in every Chromium browser Tabox ships to.
    return true;
}

// Returns: 'available' | 'sign-in-required' | 'unavailable'
export async function getAIAvailability() {
    try {
        const availability = await browser.runtime.sendMessage({ type: 'aiAvailability' });
        return availability || 'unavailable';
    } catch {
        return 'unavailable';
    }
}

// Sessions are stateless request builders: each prompt sends only the system
// prompt + that prompt (no accumulated context), so repeated prompts on one
// session don't get slower or costlier over a long run.
export async function createAISession({ systemPrompt, temperature, topK, signal } = {}) {
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

export async function promptForJSON(session, prompt, schema, signal) {
    const options = { responseConstraint: schema };
    if (signal) options.signal = signal;
    const startedAt = Date.now();
    const raw = await session.prompt(prompt, options);
    console.debug(`Tabox AI: inference ${Date.now() - startedAt}ms`);
    return parseJSONContent(raw);
}

async function requestCompletion(config, text, { responseConstraint, signal } = {}) {
    throwIfAborted(signal);
    const result = await browser.runtime.sendMessage({
        type: 'aiComplete',
        payload: {
            systemPrompt: config.systemPrompt,
            temperature: config.temperature,
            topK: config.topK,
            prompt: text,
            responseConstraint,
        },
    });
    // The SW request can't be cancelled through sendMessage — for these small
    // one-shot prompts we just discard the result after an abort.
    throwIfAborted(signal);
    if (!result || !result.ok) throw new Error((result && result.error) || 'Tabox AI: request failed');
    return result.content;
}

function throwIfAborted(signal) {
    if (signal && signal.aborted) {
        const error = new Error('Tabox AI: aborted');
        error.name = 'AbortError';
        throw error;
    }
}

// Models occasionally wrap JSON in a markdown fence even under json_schema.
function parseJSONContent(raw) {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return JSON.parse(fenced ? fenced[1] : trimmed);
}
