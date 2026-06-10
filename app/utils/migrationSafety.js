/**
 * Data-safety guard for migrations.
 *
 * Snapshots indexed collections + folders before running a migration step,
 * verifies the data-safety invariant afterward, and restores the snapshot if
 * any record was lost or shrunk (or the step threw). Restore is best-effort:
 * remove-then-set, not a single atomic transaction. Guarantees that a migration
 * can only ever augment data — never destroy or alter it.
 *
 * Reads/writes browser.storage.local directly (no storageUtils import) to avoid
 * a circular dependency: storageUtils imports this module.
 */

import { browser } from '../../static/globals';
import { STORAGE_KEYS } from './sharedConstants';
import { snapshotShape, verifyMigrationInvariant } from './migrationInvariant';

const isCollectionKey = (key) => key.startsWith(STORAGE_KEYS.COLLECTION_PREFIX);
const isFolderKey = (key) => key.startsWith(STORAGE_KEYS.FOLDER_PREFIX);

// Single-value keys the guard snapshots/restores alongside the per-record keys.
const TRACKED_SINGLETON_KEYS = [
    STORAGE_KEYS.COLLECTIONS_INDEX,
    STORAGE_KEYS.FOLDERS_INDEX,
    STORAGE_KEYS.STORAGE_VERSION,
    STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES,
    STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES,
];

const isTrackedKey = (key) =>
    isCollectionKey(key) || isFolderKey(key) || TRACKED_SINGLETON_KEYS.includes(key);

const collectFolderIndexUids = (foldersIndex) => Object.keys(foldersIndex || {});

/**
 * Capture everything needed to (a) verify the invariant and (b) fully restore.
 * Collection presence is measured by record (migrations never delete records).
 * Folder presence is measured by folders_index membership (migrations drop
 * folders from the index, not by deleting the record).
 */
const captureSnapshot = async () => {
    const all = await browser.storage.local.get(null);
    const records = {};
    const collections = [];

    Object.keys(all).forEach((key) => {
        if (!isTrackedKey(key)) return;
        records[key] = all[key];
        if (isCollectionKey(key) && all[key]) collections.push(all[key]);
    });

    const folderUids = collectFolderIndexUids(all[STORAGE_KEYS.FOLDERS_INDEX]);

    return {
        records,
        keys: new Set(Object.keys(records)),
        folderUids,
        shape: snapshotShape(collections, folderUids.map((uid) => ({ uid }))),
    };
};

/**
 * Restore captured records and delete any tracked key created during the failed
 * run (so values written by the failed migration — including indices/version/
 * tombstones that were absent before — cannot linger).
 */
const restoreSnapshot = async (snapshot) => {
    const all = await browser.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter(
        (key) => isTrackedKey(key) && !snapshot.keys.has(key)
    );
    if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
    }

    const restorePayload = {};
    snapshot.keys.forEach((key) => {
        restorePayload[key] = snapshot.records[key];
    });
    if (Object.keys(restorePayload).length > 0) {
        await browser.storage.local.set(restorePayload);
    }
};

/**
 * Build the "after" shape from current storage for invariant verification.
 * A folder the user legitimately deleted (now tombstoned) during the run is not
 * counted as lost, so genuine deletions don't trigger a false restore.
 */
const captureCurrentShape = async (snapshot) => {
    const all = await browser.storage.local.get(null);
    const collections = [];
    Object.keys(all).forEach((key) => {
        if (isCollectionKey(key) && all[key]) collections.push(all[key]);
    });

    const currentFolderUids = new Set(collectFolderIndexUids(all[STORAGE_KEYS.FOLDERS_INDEX]));
    const currentFolderTombstones = all[STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES] || {};
    snapshot.folderUids.forEach((uid) => {
        if (currentFolderTombstones[uid]) currentFolderUids.add(uid);
    });

    return snapshotShape(collections, [...currentFolderUids].map((uid) => ({ uid })));
};

/**
 * Run `fn` under the data-safety guarantee.
 * @param {string} label - for logging
 * @param {() => Promise<object>} fn - the migration step; its result is returned on success
 * @returns {Promise<object>} fn's result, or { success: false, restored: true, violations|error }
 */
export const withDataSafetyGuard = async (label, fn) => {
    const snapshot = await captureSnapshot();

    const safeRestore = async () => {
        try {
            await restoreSnapshot(snapshot);
        } catch (restoreError) {
            console.error('CRITICAL: data-safety restore failed — manual recovery may be needed:', restoreError);
        }
    };

    let result;
    try {
        result = await fn();
    } catch (error) {
        console.error(`Migration "${label}" threw — restoring snapshot:`, error);
        await safeRestore();
        return { success: false, restored: true, error: error.message };
    }

    const afterShape = await captureCurrentShape(snapshot);
    const verdict = verifyMigrationInvariant(snapshot.shape, afterShape);

    if (!verdict.ok) {
        console.error(`Migration "${label}" violated data-safety invariant — restoring:`, verdict.violations);
        await safeRestore();
        return { success: false, restored: true, violations: verdict.violations };
    }

    // Invariant held — return fn's own result verbatim (its own .success is the caller's concern).
    return result;
};
