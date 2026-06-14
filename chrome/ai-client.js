// chrome/ai-client.js
// Plain-JS port of app/ai/aiClient.js for the service worker. The SW loads this
// via importScripts and cannot import the ES-module original. Keep the two in
// sync — both wrap globalThis.LanguageModel.
(() => {
const LANGUAGE_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

async function aiAvailability() {
    if (typeof globalThis.LanguageModel === 'undefined') return 'unsupported';
    try {
        return await globalThis.LanguageModel.availability(LANGUAGE_OPTIONS);
    } catch (error) {
        console.error('Tabox AI (SW) availability check failed:', error);
        return 'unavailable';
    }
}

async function createAISession({ systemPrompt, temperature, topK, signal } = {}) {
    const options = { ...LANGUAGE_OPTIONS };
    if (systemPrompt) options.initialPrompts = [{ role: 'system', content: systemPrompt }];
    if (temperature !== undefined) options.temperature = temperature;
    if (topK !== undefined) options.topK = topK;
    if (signal) options.signal = signal;
    return globalThis.LanguageModel.create(options);
}

async function promptForJSON(session, prompt, schema, signal) {
    const options = { responseConstraint: schema };
    if (signal) options.signal = signal;
    const raw = await session.prompt(prompt, options);
    return JSON.parse(raw);
}

const aiClientApi = { aiAvailability, createAISession, promptForJSON };

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIClient = aiClientApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = aiClientApi;
})();
