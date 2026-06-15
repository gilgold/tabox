import { isAISupported, getAIAvailability, downloadModel, createAISession, promptForJSON } from '../app/ai/aiClient';

const LANGUAGE_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

describe('aiClient', () => {
    afterEach(() => {
        delete globalThis.LanguageModel;
    });

    test('isAISupported is false when LanguageModel is missing', () => {
        expect(isAISupported()).toBe(false);
    });

    test('getAIAvailability returns "unsupported" when the API is missing', async () => {
        expect(await getAIAvailability()).toBe('unsupported');
    });

    test('getAIAvailability proxies LanguageModel.availability() with language options', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockResolvedValue('downloadable') };
        expect(await getAIAvailability()).toBe('downloadable');
        expect(globalThis.LanguageModel.availability).toHaveBeenCalledWith(LANGUAGE_OPTIONS);
    });

    test('getAIAvailability returns "unavailable" when availability() throws', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockRejectedValue(new Error('boom')) };
        expect(await getAIAvailability()).toBe('unavailable');
    });

    test('downloadModel reports progress and destroys the temporary session', async () => {
        const destroy = jest.fn();
        globalThis.LanguageModel = {
            create: jest.fn(async ({ monitor }) => {
                const listeners = {};
                monitor({ addEventListener: (name, cb) => { listeners[name] = cb; } });
                listeners.downloadprogress({ loaded: 1, total: 2 });
                return { destroy };
            }),
        };
        const onProgress = jest.fn();
        await downloadModel(onProgress);
        expect(onProgress).toHaveBeenCalledWith(50);
        expect(destroy).toHaveBeenCalled();
        expect(globalThis.LanguageModel.create).toHaveBeenCalledWith(
            expect.objectContaining(LANGUAGE_OPTIONS),
        );
    });

    test('createAISession passes system prompt and sampling params', async () => {
        globalThis.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
        await createAISession({ systemPrompt: 'sys', temperature: 0.7, topK: 3 });
        expect(globalThis.LanguageModel.create).toHaveBeenCalledWith({
            ...LANGUAGE_OPTIONS,
            initialPrompts: [{ role: 'system', content: 'sys' }],
            temperature: 0.7,
            topK: 3,
        });
    });

    test('promptForJSON sends the schema as responseConstraint and parses the reply', async () => {
        const session = { prompt: jest.fn().mockResolvedValue('{"name":"Research"}') };
        const schema = { type: 'object' };
        const result = await promptForJSON(session, 'prompt text', schema);
        expect(session.prompt).toHaveBeenCalledWith('prompt text', { responseConstraint: schema });
        expect(result).toEqual({ name: 'Research' });
    });

    test('promptForJSON includes signal in options when provided', async () => {
        const session = { prompt: jest.fn().mockResolvedValue('{"name":"Research"}') };
        const schema = { type: 'object' };
        const signal = new AbortController().signal;
        await promptForJSON(session, 'prompt text', schema, signal);
        expect(session.prompt).toHaveBeenCalledWith('prompt text', { responseConstraint: schema, signal });
    });

    // The Prompt API rejects a session that sets only one of temperature/topK
    // (NotSupportedError: "must either specify both topK and temperature, or neither").
    test('createAISession pairs a default topK when only temperature is given', async () => {
        globalThis.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
        await createAISession({ temperature: 0 });
        expect(globalThis.LanguageModel.create).toHaveBeenCalledWith(
            expect.objectContaining({ temperature: 0, topK: 3 }),
        );
    });

    test('createAISession pairs a default temperature when only topK is given', async () => {
        globalThis.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
        await createAISession({ topK: 5 });
        expect(globalThis.LanguageModel.create).toHaveBeenCalledWith(
            expect.objectContaining({ topK: 5, temperature: 1 }),
        );
    });

    test('createAISession sends neither sampling param when neither is given', async () => {
        globalThis.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
        await createAISession({});
        const opts = globalThis.LanguageModel.create.mock.calls[0][0];
        expect(opts.temperature).toBeUndefined();
        expect(opts.topK).toBeUndefined();
    });
});
