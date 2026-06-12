import { isAISupported, getAIAvailability, downloadModel, createAISession, promptForJSON } from '../app/ai/aiClient';

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

    test('getAIAvailability proxies LanguageModel.availability()', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockResolvedValue('downloadable') };
        expect(await getAIAvailability()).toBe('downloadable');
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
    });

    test('createAISession passes system prompt and sampling params', async () => {
        globalThis.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
        await createAISession({ systemPrompt: 'sys', temperature: 0.7, topK: 3 });
        expect(globalThis.LanguageModel.create).toHaveBeenCalledWith({
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
});
