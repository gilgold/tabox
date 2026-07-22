// The Edge hole: Edge ships its own LanguageModel global, so feature
// detection alone would report Tabox AI as supported there. The brand check
// must win even when the global exists.
jest.mock('../app/ai/browserSupport', () => ({
    isChromeBrowser: jest.fn(),
    getBrowserName: jest.fn().mockReturnValue('Microsoft Edge'),
}));

import { isAISupported, getAIAvailability } from '../app/ai/aiClient';
import { isChromeBrowser } from '../app/ai/browserSupport';

describe('aiClient Chrome-only gating', () => {
    afterEach(() => {
        delete globalThis.LanguageModel;
    });

    test('isAISupported is false on a non-Chrome browser even when LanguageModel exists', () => {
        globalThis.LanguageModel = { availability: jest.fn() };
        isChromeBrowser.mockReturnValue(false);
        expect(isAISupported()).toBe(false);
    });

    test('getAIAvailability returns unsupported-browser on a non-Chrome browser', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockResolvedValue('available') };
        isChromeBrowser.mockReturnValue(false);
        await expect(getAIAvailability()).resolves.toBe('unsupported-browser');
        expect(globalThis.LanguageModel.availability).not.toHaveBeenCalled();
    });

    test('on Chrome, availability delegates to LanguageModel as before', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockResolvedValue('available') };
        isChromeBrowser.mockReturnValue(true);
        expect(isAISupported()).toBe(true);
        await expect(getAIAvailability()).resolves.toBe('available');
    });

    test('on Chrome without the API, availability stays unsupported', async () => {
        isChromeBrowser.mockReturnValue(true);
        expect(isAISupported()).toBe(false);
        await expect(getAIAvailability()).resolves.toBe('unsupported');
    });
});
