// chrome/ai-client.js
// Plain-JS port of app/ai/aiClient.js for the service worker. The SW loads this
// via importScripts and cannot import the ES-module original. Keep the two in
// sync — both wrap globalThis.LanguageModel.
(() => {
const LANGUAGE_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

// Defaults used to satisfy the Prompt API's "both temperature and topK, or
// neither" rule when a caller specifies only one of them.
const DEFAULT_TOP_K = 3;
const DEFAULT_TEMPERATURE = 1;

// Mirror of app/ai/browserSupport.js — Tabox AI is Chrome-only. Edge exposes
// its own incompatible LanguageModel global, so brand-check before feature-
// detecting; unidentified Chromium fails open (the feature check still gates).
function isChromeBrowser() {
    const nav = globalThis.navigator;
    if (!nav) return true;
    if (nav.brave) return false;
    const brands = ((nav.userAgentData && nav.userAgentData.brands) || []).map((entry) => entry.brand);
    if (brands.includes('Microsoft Edge') || brands.includes('Opera') || brands.includes('Brave')) return false;
    const ua = nav.userAgent || '';
    return !(/\bEdg(?:e|A|iOS)?\//.test(ua) || /\bOPR\//.test(ua) || /\bVivaldi\//.test(ua));
}

async function aiAvailability() {
    if (!isChromeBrowser()) return 'unsupported-browser';
    if (typeof globalThis.LanguageModel === 'undefined') return 'unsupported';
    try {
        return await globalThis.LanguageModel.availability(LANGUAGE_OPTIONS);
    } catch (error) {
        console.error('Tabox AI (SW) availability check failed:', error);
        return 'unavailable';
    }
}

async function createAISession({ systemPrompt, temperature, topK, signal } = {}) {
    if (!isChromeBrowser() || typeof globalThis.LanguageModel === 'undefined') {
        throw new Error('Tabox AI: LanguageModel is unavailable in this context');
    }
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

async function promptForJSON(session, prompt, schema, signal) {
    const options = { responseConstraint: schema };
    if (signal) options.signal = signal;
    const startedAt = Date.now();
    const raw = await session.prompt(prompt, options);
    console.debug(`Tabox AI: inference ${Date.now() - startedAt}ms`);
    return JSON.parse(raw);
}

const aiClientApi = { aiAvailability, createAISession, promptForJSON };

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIClient = aiClientApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = aiClientApi;
})();
