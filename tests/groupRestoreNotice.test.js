import { browser } from '../static/globals';
import { showInfoToast } from '../app/toastHelpers';
import { initGroupRestoreNoticeWatcher } from '../app/utils/groupRestoreNotice';

jest.mock('../app/toastHelpers', () => ({ showInfoToast: jest.fn() }));

describe('group restore partial-success notice for popup and full-page', () => {
    let cleanup;
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({});
        browser.storage.local.remove = jest.fn().mockResolvedValue();
    });
    afterEach(() => { cleanup?.(); });
    test('reopened popup explains partial success without private data and consumes notice', async () => {
        browser.storage.local.get.mockResolvedValue({ groupRestoreNoticePending: {
            tabsOpened: 3, groupsFailed: 2, error: 'private error', title: 'Private title', url: 'https://example.invalid/secret',
        } });
        cleanup = initGroupRestoreNoticeWatcher();
        await flush();
        expect(showInfoToast).toHaveBeenCalledWith('Opened 3 tabs, but 2 saved groups could not be fully restored.', 10000);
        expect(browser.storage.local.remove).toHaveBeenCalledWith('groupRestoreNoticePending');
    });
    test.each([false, true])('live notice in full-page: %s; popup retains for next mount', async isFullPage => {
        cleanup = initGroupRestoreNoticeWatcher({ isFullPage });
        await flush();
        browser.storage.local.get.mockResolvedValue({ groupRestoreNoticePending: { tabsOpened: 1, groupsFailed: 1 } });
        expect(browser.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
        const listener = browser.storage.onChanged.addListener.mock.calls[0][0];
        listener({ groupRestoreNoticePending: { newValue: { tabsOpened: 1, groupsFailed: 1 } } }, 'local');
        await flush();
        expect(showInfoToast).toHaveBeenCalledWith('Opened 1 tab, but 1 saved group could not be fully restored.', 10000);
        expect(browser.storage.local.remove.mock.calls).toEqual(isFullPage ? [['groupRestoreNoticePending']] : []);
    });
    test.each([undefined, { tabsOpened: 0, groupsFailed: 1 }, { tabsOpened: 2, groupsFailed: 0 }])('no partial success means no toast: %p', async pending => {
        browser.storage.local.get.mockResolvedValue({ groupRestoreNoticePending: pending });
        cleanup = initGroupRestoreNoticeWatcher();
        await flush();
        expect(showInfoToast).not.toHaveBeenCalled();
    });
    test('ignores other storage changes and removes the listener on cleanup', async () => {
        cleanup = initGroupRestoreNoticeWatcher();
        await flush();
        expect(browser.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
        const listener = browser.storage.onChanged.addListener.mock.calls[0][0];
        listener({ groupRestoreNoticePending: { newValue: {} } }, 'sync');
        listener({ unrelated: { newValue: {} } }, 'local');
        expect(browser.storage.local.get).toHaveBeenCalledTimes(1);
        cleanup();
        cleanup = null;
        expect(browser.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
    });
});
