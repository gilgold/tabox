import { browser } from '../../static/globals';

export const triggerBackgroundSync = async ({
    updateLocalTimestamp = true,
    refreshContextMenu = false,
} = {}) => {
    if (updateLocalTimestamp) {
        await browser.storage.local.set({ localTimestamp: Date.now() });
    }

    if (refreshContextMenu) {
        await browser.runtime.sendMessage({ type: 'addCollection' });
    }

    return browser.runtime.sendMessage({ type: 'updateRemote' });
};
