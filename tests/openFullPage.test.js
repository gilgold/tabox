import { openOrFocusFullPageInCurrentWindow } from '../app/utils/openFullPage';

describe('openOrFocusFullPageInCurrentWindow', () => {
    beforeEach(() => {
        browser.tabs.query.mockReset();
        browser.tabs.update.mockReset();
        browser.tabs.create.mockReset();
        browser.runtime.getURL.mockReturnValue('chrome-extension://test/fullpage.html');
    });

    test('focuses the existing full-page tab in the current window', async () => {
        browser.tabs.query.mockResolvedValue([{ id: 42, url: 'chrome-extension://test/fullpage.html' }]);

        const result = await openOrFocusFullPageInCurrentWindow();

        expect(browser.tabs.query).toHaveBeenCalledWith({
            currentWindow: true,
            url: 'chrome-extension://test/fullpage.html',
        });
        expect(browser.tabs.update).toHaveBeenCalledWith(42, { active: true });
        expect(browser.tabs.create).not.toHaveBeenCalled();
        expect(result).toEqual({ id: 42, url: 'chrome-extension://test/fullpage.html' });
    });

    test('opens a new full-page tab when none exists in the current window', async () => {
        browser.tabs.query.mockResolvedValue([]);
        browser.tabs.create.mockResolvedValue({ id: 99, url: 'chrome-extension://test/fullpage.html' });

        const result = await openOrFocusFullPageInCurrentWindow();

        expect(browser.tabs.update).not.toHaveBeenCalled();
        expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/fullpage.html' });
        expect(result).toEqual({ id: 99, url: 'chrome-extension://test/fullpage.html' });
    });
});
