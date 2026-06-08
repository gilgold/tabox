/**
 * Pure helpers describing the data-safety invariant for migrations.
 * No storage access — operates on plain snapshots so it is trivially testable.
 *
 * Invariant (over the migration window, where no user edits occur):
 *   - every collection uid present before is present after,
 *     with tabs.length and chromeGroups.length >= before;
 *   - every folder uid present before is present after.
 * Additions and field transforms (colors, urls, timestamps) are allowed.
 */

/**
 * Reduce full records to the minimal shape the invariant cares about.
 * @param {Array<object>} collections - collection records with uid/tabs/chromeGroups
 * @param {Array<object>} folders - folder records with uid
 * @returns {{collections: Object, folders: Object}}
 */
export const snapshotShape = (collections = [], folders = []) => {
    const collectionShape = {};
    collections.forEach((c) => {
        if (!c || !c.uid) return;
        collectionShape[c.uid] = {
            tabs: Array.isArray(c.tabs) ? c.tabs.length : 0,
            groups: Array.isArray(c.chromeGroups) ? c.chromeGroups.length : 0, // normalised from chromeGroups
        };
    });

    const folderShape = {};
    folders.forEach((f) => {
        if (!f || !f.uid) return;
        folderShape[f.uid] = true;
    });

    return { collections: collectionShape, folders: folderShape };
};

/**
 * Compare two snapshots produced by snapshotShape.
 * @returns {{ok: boolean, violations: Array<object>}}
 */
export const verifyMigrationInvariant = (before, after) => {
    const violations = [];

    Object.keys(before.collections).forEach((uid) => {
        const b = before.collections[uid];
        const a = after.collections[uid];
        if (!a) {
            violations.push({ type: 'collection_lost', uid });
            return;
        }
        if (a.tabs < b.tabs) {
            violations.push({ type: 'tabs_shrunk', uid, before: b.tabs, after: a.tabs });
        }
        if (a.groups < b.groups) {
            violations.push({ type: 'groups_shrunk', uid, before: b.groups, after: a.groups });
        }
    });

    Object.keys(before.folders).forEach((uid) => {
        if (!after.folders[uid]) {
            violations.push({ type: 'folder_lost', uid });
        }
    });

    return { ok: violations.length === 0, violations };
};
