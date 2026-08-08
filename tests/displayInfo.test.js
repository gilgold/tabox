import { getDisplayInfo } from '../app/utils/displayInfo';

describe('getDisplayInfo', () => {
    afterEach(() => { delete globalThis.browser.system; });

    test('returns browser.system.display.getInfo() results when available', async () => {
        const displays = [{ bounds: { top: 0, left: 0, width: 2560, height: 1440 } }];
        globalThis.browser.system = { display: { getInfo: jest.fn().mockResolvedValue(displays) } };
        expect(await getDisplayInfo()).toEqual(displays);
    });

    test('falls back to a window.screen pseudo-display when the API is missing (Firefox)', async () => {
        const displays = await getDisplayInfo();
        expect(displays).toHaveLength(1);
        expect(displays[0].bounds).toEqual({
            top: 0,
            left: 0,
            width: window.screen.width,
            height: window.screen.height,
        });
    });

    test('falls back when getInfo rejects', async () => {
        globalThis.browser.system = { display: { getInfo: jest.fn().mockRejectedValue(new Error('nope')) } };
        const displays = await getDisplayInfo();
        expect(displays).toHaveLength(1);
    });
});
