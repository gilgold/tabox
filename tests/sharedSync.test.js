jest.mock('../static/globals', () => ({
    browser: {
        storage: {
            local: {
                set: jest.fn(),
            },
        },
        runtime: {
            sendMessage: jest.fn(),
        },
    },
}));

import { browser } from '../static/globals';
import { triggerBackgroundSync } from '../app/utils/sharedSync';

describe('triggerBackgroundSync', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.set.mockResolvedValue(undefined);
        browser.runtime.sendMessage.mockResolvedValue(true);
    });

    test('updates localTimestamp and requests remote sync by default', async () => {
        await triggerBackgroundSync();

        expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            localTimestamp: expect.any(Number),
        }));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'updateRemote' });
    });

    test('refreshes the context menu before syncing when requested', async () => {
        await triggerBackgroundSync({ refreshContextMenu: true });

        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, { type: 'addCollection' });
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, { type: 'updateRemote' });
    });
});
