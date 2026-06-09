import { browser } from '../../static/globals';
import { STORAGE_KEYS } from './sharedConstants';

/**
 * Find collection records that exist in storage but are not referenced by the
 * collections_index (and were not deliberately deleted). These are the
 * collections the pre-#102 migration dropped from the index. Read-only.
 */
export const detectRecoverableCollections = async () => {
    try {
        const all = await browser.storage.local.get(null);
        const index = all[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tombstones = all[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES] || {};
        const prefix = STORAGE_KEYS.COLLECTION_PREFIX;

        const orphans = [];
        for (const key of Object.keys(all)) {
            if (!key.startsWith(prefix)) continue;
            const uid = key.slice(prefix.length);
            if (index[uid]) continue;        // already visible
            if (tombstones[uid]) continue;   // user deleted it deliberately

            const record = all[key];
            if (!record || typeof record !== 'object' || !Array.isArray(record.tabs)) continue;

            orphans.push({
                uid,
                name: record.name || 'Untitled Collection',
                tabCount: record.tabs.length,
                createdOn: record.createdOn || 0,
                lastUpdated: record.lastUpdated != null ? record.lastUpdated : null,
                parentId: record.parentId != null ? record.parentId : null,
                color: record.color || 'default',
            });
        }

        orphans.sort((a, b) => (b.createdOn || 0) - (a.createdOn || 0));
        return orphans;
    } catch (error) {
        console.error('Failed to detect recoverable collections:', error);
        return [];
    }
};
