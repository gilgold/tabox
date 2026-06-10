import { browser } from '../../static/globals';
import { STORAGE_KEYS } from './sharedConstants';
import { withDataSafetyGuard } from './migrationSafety';

/**
 * Find collection records that exist in storage but are not referenced by the
 * collections_index (and were not deliberately deleted). These are the
 * collections the pre-#102 migration dropped from the index. Read-only.
 */
export const detectRecoverableCollections = async () => {
    try {
        // get(null) loads every key (including all collection_<uid> records with
        // their tabs) into memory in one pass. That is the only way to enumerate
        // unknown keys in extension storage; this function returns a lean summary
        // and retains nothing, so the spike is transient.
        const all = await browser.storage.local.get(null);
        const index = all[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tombstones = all[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES] || {};
        const prefix = STORAGE_KEYS.COLLECTION_PREFIX;

        const orphans = [];
        for (const key of Object.keys(all)) {
            if (!key.startsWith(prefix)) continue;
            const uid = key.slice(prefix.length);
            if (uid in index) continue;        // already visible
            if (uid in tombstones) continue;   // user deleted it deliberately

            const record = all[key];
            if (!record || typeof record !== 'object' || !Array.isArray(record.tabs)) continue;

            orphans.push({
                uid,
                name: record.name || 'Untitled Collection',
                tabCount: record.tabs.length,
                createdOn: record.createdOn != null ? record.createdOn : 0,
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

/**
 * Re-link selected orphaned collections into the index. ADDITIVE ONLY: it adds
 * index entries pointing at records that already exist; it never overwrites a
 * live record, resurrects a tombstoned uid, or removes anything. Runs under the
 * data-safety guard, which rolls back on any throw or invariant violation.
 * @param {string[]} uids
 * @returns {Promise<{success: boolean, recovered: number, uids: string[]}>}
 */
export const recoverOrphanedCollections = async (uids = []) => {
    if (!Array.isArray(uids) || uids.length === 0) {
        return { success: true, recovered: 0, uids: [] };
    }

    return withDataSafetyGuard('orphan-recovery', async () => {
        const initials = await browser.storage.local.get([
            STORAGE_KEYS.COLLECTIONS_INDEX,
            STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES,
            STORAGE_KEYS.FOLDERS_INDEX,
        ]);
        const index = initials[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tombstones = initials[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES] || {};
        const foldersIndex = initials[STORAGE_KEYS.FOLDERS_INDEX] || {};

        const keys = uids.map((uid) => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
        const records = await browser.storage.local.get(keys);

        const nextIndex = { ...index };
        const writePayload = {};
        const recoveredUids = [];
        const now = Date.now();

        uids.forEach((uid, i) => {
            if (uid in index) return;        // already visible
            if (uid in tombstones) return;   // deliberately deleted
            const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const record = records[key];
            if (!record || !Array.isArray(record.tabs)) return;

            // Missing order -> sort last. The sentinel is not unique across separate
            // recovery runs; that is acceptable (the user can reorder afterward).
            const order = record.order !== undefined ? record.order : 999999 + i;
            const lastUpdated = record.lastUpdated != null ? record.lastUpdated : (record.createdOn || now);
            const lastOpened = record.lastOpened !== undefined ? record.lastOpened : null;
            const parentDead = record.parentId && !(record.parentId in foldersIndex);
            const parentId = parentDead ? null : (record.parentId ?? null);

            const needsPatch = record.order === undefined
                || record.lastUpdated === undefined
                || record.lastOpened === undefined
                || parentDead;
            const normalized = needsPatch ? { ...record, order, lastUpdated, lastOpened, parentId } : record;
            if (needsPatch) writePayload[key] = normalized;

            nextIndex[uid] = {
                name: normalized.name || 'Untitled Collection',
                type: 'collection',
                tabCount: Array.isArray(normalized.tabs) ? normalized.tabs.length : 0,
                lastUpdated,
                lastOpened,
                createdOn: normalized.createdOn || now,
                color: normalized.color || 'default',
                size: JSON.stringify(normalized).length,
                parentId,
                order,
            };
            recoveredUids.push(uid);
        });

        if (recoveredUids.length > 0) {
            writePayload[STORAGE_KEYS.COLLECTIONS_INDEX] = nextIndex;
            await browser.storage.local.set(writePayload);
        }

        return { success: true, recovered: recoveredUids.length, uids: recoveredUids };
    });
};
