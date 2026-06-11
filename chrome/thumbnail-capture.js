// Thumbnail capture pipeline for the quick tab switcher.
// Captures the visible tab of a window on activation/load/focus (debounced to
// respect captureVisibleTab's 2-calls-per-second quota), downscales to ~320px
// JPEG, and keeps an LRU-capped cache in chrome.storage.session — memory-only,
// never written to disk, which also keeps incognito captures off disk.
(function (global) {
  const THUMB_PREFIX = 'thumb_';
  const THUMB_INDEX_KEY = 'thumb_index';
  const MAX_THUMBS = 100;
  const CAPTURE_DEBOUNCE_MS = 600;
  const TARGET_WIDTH = 320;

  async function defaultDownscale(dataUrl) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      return dataUrl;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });
  }

  function createThumbnailCapture(browser, { downscale = defaultDownscale } = {}) {
    const debounceTimers = new Map();

    async function storeThumbnail(tabId, dataUrl) {
      const indexData = await browser.storage.session.get(THUMB_INDEX_KEY);
      let index = indexData?.[THUMB_INDEX_KEY] || [];
      index = [tabId, ...index.filter((id) => id !== tabId)];
      const evicted = index.slice(MAX_THUMBS);
      index = index.slice(0, MAX_THUMBS);
      await browser.storage.session.set({
        [THUMB_INDEX_KEY]: index,
        [`${THUMB_PREFIX}${tabId}`]: { dataUrl, capturedAt: Date.now() },
      });
      if (evicted.length > 0) {
        await browser.storage.session.remove(evicted.map((id) => `${THUMB_PREFIX}${id}`));
      }
    }

    async function hasPermission() {
      try {
        return await browser.permissions.contains({ origins: ['<all_urls>'] });
      } catch {
        return false;
      }
    }

    async function captureWindow(windowId) {
      try {
        if (!(await hasPermission())) return;
        const tabs = await browser.tabs.query({ active: true, windowId });
        const tab = tabs?.[0];
        if (!tab || tab.id === undefined) return;
        const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
        if (!dataUrl) return;
        await storeThumbnail(tab.id, await downscale(dataUrl));
      } catch {
        // chrome:// pages, store pages, closed windows, quota errors —
        // the switcher just falls back to the favicon card.
      }
    }

    function scheduleCapture(windowId) {
      if (windowId === undefined || windowId === null || windowId < 0) return;
      const existing = debounceTimers.get(windowId);
      if (existing) clearTimeout(existing);
      debounceTimers.set(windowId, setTimeout(() => {
        debounceTimers.delete(windowId);
        captureWindow(windowId);
      }, CAPTURE_DEBOUNCE_MS));
    }

    const onActivated = (activeInfo) => scheduleCapture(activeInfo.windowId);
    const onUpdated = (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab?.active) scheduleCapture(tab.windowId);
    };
    const onFocusChanged = (windowId) => scheduleCapture(windowId);
    const onTabRemoved = async (tabId) => {
      try {
        const indexData = await browser.storage.session.get(THUMB_INDEX_KEY);
        const index = (indexData?.[THUMB_INDEX_KEY] || []).filter((id) => id !== tabId);
        await browser.storage.session.set({ [THUMB_INDEX_KEY]: index });
        await browser.storage.session.remove(`${THUMB_PREFIX}${tabId}`);
      } catch { /* noop */ }
    };

    async function clearCache() {
      try {
        const indexData = await browser.storage.session.get(THUMB_INDEX_KEY);
        const index = indexData?.[THUMB_INDEX_KEY] || [];
        await browser.storage.session.remove([
          THUMB_INDEX_KEY,
          ...index.map((id) => `${THUMB_PREFIX}${id}`),
        ]);
      } catch { /* noop */ }
    }

    async function captureAllWindows() {
      try {
        const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
        // Stagger the per-window debounces so N windows don't all fire in the
        // same second against captureVisibleTab's 2-calls-per-second quota.
        windows.forEach((win, index) => {
          setTimeout(() => scheduleCapture(win.id), index * CAPTURE_DEBOUNCE_MS);
        });
      } catch { /* noop */ }
    }

    // Synchronous on purpose: MV3 only wakes the service worker for listeners
    // registered in the first turn of the event loop. The permission is checked
    // per capture instead, so un-granted events are cheap no-ops.
    function init() {
      browser.tabs.onActivated.addListener(onActivated);
      browser.tabs.onUpdated.addListener(onUpdated);
      browser.windows.onFocusChanged.addListener(onFocusChanged);
      browser.tabs.onRemoved.addListener(onTabRemoved);
      // The grant itself must prime the cache. The popup can't be trusted to do
      // it: the native permission dialog steals focus and (on macOS) closes the
      // popup before its permissions.request() await resumes — and grants made
      // from chrome://extensions never go through the popup at all.
      browser.permissions.onAdded.addListener(() => {
        captureAllWindows();
      });
      browser.permissions.onRemoved.addListener(async () => {
        if (!(await hasPermission())) await clearCache();
      });
    }

    return { init, scheduleCapture, captureAllWindows, clearCache };
  }

  const api = { createThumbnailCapture };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.TaboxThumbnails = api;
})(globalThis);
