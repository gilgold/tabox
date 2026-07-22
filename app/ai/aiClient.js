// Thin wrapper around Chrome's built-in Prompt API (the LanguageModel global,
// stable for extensions since Chrome 138). Every Tabox AI feature goes through
// this module so the underlying API — or the execution context (e.g. moving
// inference to the service worker) — can change without touching feature code.

// The Prompt API requires declared input/output languages to attest output
// safety; omitting them logs a warning and can degrade output quality.
import { isChromeBrowser } from './browserSupport';

const LANGUAGE_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

// Defaults used to satisfy the Prompt API's "both temperature and topK, or
// neither" rule when a caller specifies only one of them.
const DEFAULT_TOP_K = 3;
const DEFAULT_TEMPERATURE = 1;

export function isAISupported() {
    // Brand check first: Edge exposes its own LanguageModel global (a different
    // model), which would otherwise make Tabox AI look supported there.
    return isChromeBrowser() && typeof globalThis.LanguageModel !== 'undefined';
}

// Returns: 'unsupported-browser' | 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export async function getAIAvailability() {
    if (!isChromeBrowser()) return 'unsupported-browser';
    if (typeof globalThis.LanguageModel === 'undefined') return 'unsupported';
    try {
        return await globalThis.LanguageModel.availability(LANGUAGE_OPTIONS);
    } catch (error) {
        console.error('Tabox AI availability check failed:', error);
        return 'unavailable';
    }
}

// Creating a session triggers the model download. Must be called from a user
// gesture. onProgress receives an integer percentage (0-100).
export async function downloadModel(onProgress) {
    const session = await globalThis.LanguageModel.create({
        ...LANGUAGE_OPTIONS,
        monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
                if (onProgress) onProgress(e.total ? Math.floor((e.loaded / e.total) * 100) : 0);
            });
        },
    });
    session.destroy();
}

export async function createAISession({ systemPrompt, temperature, topK, signal } = {}) {
    const options = { ...LANGUAGE_OPTIONS };
    if (systemPrompt) options.initialPrompts = [{ role: 'system', content: systemPrompt }];
    // The Prompt API requires temperature and topK together (or neither); pair a
    // default for whichever a caller omitted so a one-sided value doesn't throw
    // NotSupportedError.
    if (temperature !== undefined || topK !== undefined) {
        options.temperature = temperature !== undefined ? temperature : DEFAULT_TEMPERATURE;
        options.topK = topK !== undefined ? topK : DEFAULT_TOP_K;
    }
    if (signal) options.signal = signal;
    return globalThis.LanguageModel.create(options);
}

export async function promptForJSON(session, prompt, schema, signal) {
    const options = { responseConstraint: schema };
    if (signal) options.signal = signal;
    const startedAt = Date.now();
    const raw = await session.prompt(prompt, options);
    console.debug(`Tabox AI: inference ${Date.now() - startedAt}ms`);
    return JSON.parse(raw);
}
