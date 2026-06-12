// Thin wrapper around Chrome's built-in Prompt API (the LanguageModel global,
// stable for extensions since Chrome 138). Every Tabox AI feature goes through
// this module so the underlying API — or the execution context (e.g. moving
// inference to the service worker) — can change without touching feature code.

// The Prompt API requires declared input/output languages to attest output
// safety; omitting them logs a warning and can degrade output quality.
const LANGUAGE_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export function isAISupported() {
    return typeof globalThis.LanguageModel !== 'undefined';
}

// Returns: 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export async function getAIAvailability() {
    if (!isAISupported()) return 'unsupported';
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

export async function createAISession({ systemPrompt, temperature, topK } = {}) {
    const options = { ...LANGUAGE_OPTIONS };
    if (systemPrompt) options.initialPrompts = [{ role: 'system', content: systemPrompt }];
    if (temperature !== undefined) options.temperature = temperature;
    if (topK !== undefined) options.topK = topK;
    return globalThis.LanguageModel.create(options);
}

export async function promptForJSON(session, prompt, schema) {
    const raw = await session.prompt(prompt, { responseConstraint: schema });
    return JSON.parse(raw);
}
