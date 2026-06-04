/**
 * Deferred-loading URL helpers.
 *
 * SYNCHRONIZED WITH chrome/background-utils.js (unwrapDeferredUrl / isDeferredLoadingUrl).
 * The background service worker loads its scripts via importScripts and cannot import
 * this ES module, so an identical copy lives in background-utils.js. Keep both in sync.
 *
 * Smart tab loading opens deferred tabs at an extension page that carries the real
 * destination URL. Two on-the-wire formats exist:
 *   - legacy (<= v4.1):  deferedLoading.html?url=<enc>&favicon=<enc>
 *   - current (>  v4.1): deferedLoading.html#<enc(JSON.stringify({ url, favicon }))>
 * The hash form avoids ad-blocker filters that match the `?url=` redirect pattern, but
 * collections saved by older builds may still hold the legacy wrapper, so both must be
 * understood when unwrapping.
 */

const DEFERRED_PAGE_MARKER = 'deferedLoading.html';

/**
 * @param {unknown} url
 * @returns {boolean} true when the value is a deferred-loading wrapper URL
 */
export const isDeferredLoadingUrl = (url) =>
    typeof url === 'string' && url.indexOf(DEFERRED_PAGE_MARKER) > -1;

/**
 * Return the real destination URL carried by a deferred-loading wrapper.
 * Non-wrapper values (and anything that fails to parse) are returned unchanged.
 * @param {string} url
 * @returns {string}
 */
export const unwrapDeferredUrl = (url) => {
    if (!isDeferredLoadingUrl(url)) {
        return url;
    }

    try {
        const parsed = new URL(url);

        // Current format: payload lives in the hash fragment.
        if (parsed.hash && parsed.hash.length > 1) {
            const decoded = JSON.parse(decodeURIComponent(parsed.hash.slice(1)));
            if (decoded && typeof decoded.url === 'string' && decoded.url) {
                return decoded.url;
            }
        }

        // Legacy format: payload lives in the query string.
        const queryUrl = parsed.searchParams.get('url');
        if (queryUrl) {
            return queryUrl;
        }
    } catch {
        // Malformed wrapper - return the original string below.
        return url;
    }

    return url;
};

/**
 * Extract the real destination URLs from a collection's tabs.
 * Deferred-loading wrappers are unwrapped; falsy/empty values are dropped.
 * Safe for collections with no `tabs`.
 * @param {{ tabs?: Array<{ url?: string }> }} collection
 * @returns {string[]}
 */
export const getCollectionUrls = (collection) => {
    const tabs = (collection && collection.tabs) || [];
    return tabs
        .map((tab) => unwrapDeferredUrl(tab && tab.url))
        .filter((url) => Boolean(url));
};

/**
 * Build a newline-separated list of a collection's URLs.
 * @param {{ tabs?: Array<{ url?: string }> }} collection
 * @returns {string}
 */
export const buildCollectionUrlList = (collection) =>
    getCollectionUrls(collection).join('\n');

/**
 * Build a formatted, newline-separated URL listing for a folder.
 *
 * Format:
 *   <Folder Name>
 *
 *   <Collection Name 1>
 *   https://url1
 *   https://url2
 *
 *   <Collection Name 2>
 *   https://url3
 *
 * Each collection block is its name followed by its URLs (one per line); a
 * collection with no URLs still shows its name header. Blocks are separated by a
 * single blank line.
 * @param {{ name?: string }} folder
 * @param {Array<{ name?: string, tabs?: Array<{ url?: string }> }>} collections
 * @returns {string}
 */
export const buildFolderUrlList = (folder, collections) => {
    const folderName = (folder && folder.name) || '';
    const blocks = (collections || []).map((collection) => {
        const name = (collection && collection.name) || '';
        const urls = getCollectionUrls(collection);
        return urls.length > 0 ? `${name}\n${urls.join('\n')}` : name;
    });

    return `${folderName}\n\n${blocks.join('\n\n')}`;
};
