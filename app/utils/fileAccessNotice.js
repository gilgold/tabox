import { browser } from '../../static/globals';
import { showInfoToast } from '../toastHelpers';

// Storage flag set when the user clicks "Don't show again" on the file-access
// notice — same one-shot dismiss pattern as orphanRecoveryModalDismissed.
export const FILE_ACCESS_NOTICE_DISMISSED_KEY = 'fileAccessNoticeDismissed';

// Written by the background's openTabs when file:// tabs are skipped — the
// popup is usually torn down the instant the opened tabs take focus, so a
// directly-shown toast dies unseen. The views consume this key instead.
export const FILE_ACCESS_NOTICE_PENDING_KEY = 'fileAccessNoticePending';

const isFirefox = () => browser.runtime.getURL('').startsWith('moz-extension://');
const isEdge = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('Edg/');

export const getFileAccessNoticeMessage = (skippedCount) => {
    const tabsLabel = `${skippedCount} local file tab${skippedCount === 1 ? '' : 's'}`;
    if (isFirefox()) {
        return `${tabsLabel} skipped — Firefox doesn't let extensions open file:// links. Open them manually from the collection.`;
    }
    const extensionsPage = isEdge() ? 'edge://extensions' : 'chrome://extensions';
    return `${tabsLabel} skipped. To open them, turn on "Allow access to file URLs" for Tabox in ${extensionsPage}.`;
};

// Opens the extension's own details page, where the "Allow access to file URLs"
// switch lives. Chromium only — Firefox has no equivalent switch.
export const openExtensionSettingsPage = async () => {
    const extensionsPage = isEdge() ? 'edge://extensions' : 'chrome://extensions';
    await browser.tabs.create({ url: `${extensionsPage}/?id=${browser.runtime.id}` });
};

/**
 * Shows the "local file tabs were skipped" notice, unless the user dismissed it
 * with "Don't show again". Called from openCollectionTabs — the shared open path
 * for both the popup and the full-page view.
 * @param {number} skippedCount - result.skippedForFileAccess from the background
 */
export const maybeShowFileAccessNotice = async (skippedCount) => {
    if (!skippedCount || skippedCount <= 0) return false;

    const stored = await browser.storage.local.get(FILE_ACCESS_NOTICE_DISMISSED_KEY);
    if (stored?.[FILE_ACCESS_NOTICE_DISMISSED_KEY]) return false;

    const actions = [];
    if (!isFirefox()) {
        actions.push({ label: 'Open settings', onClick: openExtensionSettingsPage });
    }
    actions.push({
        label: "Don't show again",
        onClick: () => browser.storage.local.set({ [FILE_ACCESS_NOTICE_DISMISSED_KEY]: true }),
    });

    showInfoToast(getFileAccessNoticeMessage(skippedCount), 12000, {
        title: 'Local file tabs skipped',
        actions,
    });
    return true;
};

/**
 * Watches for the background-persisted pending notice and shows the toast when
 * this view can actually display it. Called from App.js (both views):
 * - on mount, the view is stable (the user just opened it), so the notice is
 *   shown and consumed — this is how a popup-initiated open (whose popup died
 *   on focus shift) and the UI-less context-menu/keyboard opens surface it;
 * - on a live storage change, the persistent full-page view shows and consumes
 *   it immediately, while a popup shows it best-effort WITHOUT consuming (the
 *   popup is usually about to be torn down), leaving it for the next view.
 * @returns {Function} cleanup that removes the storage listener
 */
export const initFileAccessNoticeWatcher = ({ isFullPage = false } = {}) => {
    const showPending = async (consume) => {
        const stored = await browser.storage.local.get(FILE_ACCESS_NOTICE_PENDING_KEY);
        const pending = stored?.[FILE_ACCESS_NOTICE_PENDING_KEY];
        if (!pending?.count) return;
        await maybeShowFileAccessNotice(pending.count);
        if (consume) {
            await browser.storage.local.remove(FILE_ACCESS_NOTICE_PENDING_KEY);
        }
    };
    showPending(true);

    const handleChange = (changes, areaName) => {
        if (areaName === 'local' && changes[FILE_ACCESS_NOTICE_PENDING_KEY]?.newValue) {
            showPending(isFullPage);
        }
    };
    browser.storage.onChanged.addListener(handleChange);
    return () => browser.storage.onChanged.removeListener(handleChange);
};
