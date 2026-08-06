/**
 * Permission-guard helpers for shared folders.
 *
 * A folder becomes "shared" once it carries a `shared` marker
 * (`{ folderId, role, ownerEmail, members }`); `role` is one of
 * `'owner' | 'write' | 'read'`. Only `'read'` blocks local edits — everything
 * else (owner/write, or no `shared` marker at all) is editable.
 */

/**
 * @param {object|null|undefined} folder
 * @returns {boolean} Whether the folder is shared (has a `shared` marker).
 */
export function isSharedFolder(folder) {
    return Boolean(folder?.shared?.folderId);
}

/**
 * @param {object|null|undefined} folder
 * @returns {boolean} Whether the current user only has read access to the folder.
 */
export function isReadOnlySharedFolder(folder) {
    return folder?.shared?.role === 'read';
}

/**
 * @param {object|null|undefined} folder - null/undefined means "root" (always editable).
 * @returns {boolean} Whether the folder can be edited by the current user.
 */
export function canEditFolder(folder) {
    return !isReadOnlySharedFolder(folder);
}

/**
 * Guard a mutation against a folder's permission. Call this at every write
 * chokepoint that touches a folder (or a collection inside one) before the
 * write happens.
 *
 * @param {object|null|undefined} folder - The folder being written to (or read from, for its permission).
 * @param {Function} [openNoPermission] - Called (no args) when the edit is blocked, e.g. to open the No-Permission modal.
 * @returns {boolean} true if the edit is allowed; false if it was blocked.
 */
export function guardFolderEdit(folder, openNoPermission) {
    if (canEditFolder(folder)) return true;
    if (typeof openNoPermission === 'function') openNoPermission();
    return false;
}
