import { browser } from '../../static/globals';
import { isSingleWindowBrowser } from './platform';

export async function openOrFocusFullPageInCurrentWindow() {
    const fullPageUrl = browser.runtime.getURL('fullpage.html');
    // Firefox for Android: one tab strip, and each tab is its own "window".
    const existingTabs = await browser.tabs.query(isSingleWindowBrowser()
        ? { url: fullPageUrl }
        : { currentWindow: true, url: fullPageUrl });
    const existingTab = existingTabs[0];

    if (existingTab?.id != null) {
        await browser.tabs.update(existingTab.id, { active: true });
        return existingTab;
    }

    return browser.tabs.create({ url: fullPageUrl });
}
