import { unwrapDeferredUrl } from '../../chrome/deferred-tabs';
export { isDeferredLoadingUrl, unwrapDeferredUrl, normalizeDeferredTab } from '../../chrome/deferred-tabs';

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
