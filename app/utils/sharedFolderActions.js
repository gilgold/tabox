/**
 * Shared-folder Leave/Unshare actions.
 *
 * Lifted out of FolderContainer.js/FPSidebar.js/FPContentArea.js (which used
 * to each inline an identical sendMessage+toast+refresh block) so
 * SharedActionConfirmModal's Confirm button has ONE implementation to call,
 * regardless of which of the three menu entry points opened it.
 */
import { browser } from '../../static/globals';
import { showInfoToast, showErrorToast, showSuccessToast } from '../toastHelpers';
import { ensureNotificationsPermission } from './notificationsPermission';
import {
    loadCollectionsIndex,
    loadMultipleCollections,
    sortCollectionsForDisplay,
    updateCollectionsOrder,
} from './storageUtils';

/**
 * Leave a shared folder the caller is a member of. Keeps a local copy.
 * @param {object} folder - The folder record (must carry `uid`/`name`).
 * @param {Function} [onDataUpdate] - Called after a successful leave to refresh data.
 * @returns {Promise<boolean>} Whether the leave succeeded.
 */
export async function leaveSharedFolder(folder, onDataUpdate) {
    try {
        const res = await browser.runtime.sendMessage({ type: 'sharedLeaveFolder', folderId: folder.uid });
        if (!res?.ok) {
            showErrorToast('Couldn\'t leave the folder — please try again.');
            return false;
        }
        showInfoToast(`You left "${folder.name}". A local copy was kept.`);
        if (onDataUpdate) await onDataUpdate();
        return true;
    } catch (error) {
        console.error('Error leaving shared folder:', error);
        showErrorToast('Couldn\'t leave the folder — please try again.');
        return false;
    }
}

/**
 * Respond to a pending shared-folder invite (accept or decline). Declining
 * marks the invite "declined" on the owner's member list; the background
 * handler removes the invite from the shared_pending_invites record either
 * way, which flows back into pendingInvitesState via storage.onChanged.
 * @param {object} invite - Pending invite ({ folderId, folderName, ownerEmail, role }).
 * @param {boolean} accept - true to accept, false to decline.
 * @param {Function} [onDataUpdate] - Called after a successful accept to refresh data.
 * @returns {Promise<boolean>} Whether the response succeeded.
 */
export async function respondToSharedInvite(invite, accept, onDataUpdate) {
    try {
        // First shared-folder interaction — ask for the optional notifications
        // permission (fire-and-forget; declining never blocks the flow).
        if (accept) ensureNotificationsPermission();
        const res = await browser.runtime.sendMessage({ type: 'sharedRespondInvite', folderId: invite.folderId, accept });
        if (!res?.ok) {
            showErrorToast('Could not respond to the invite. Please try again.');
            return false;
        }
        if (accept) {
            showSuccessToast(`"${invite.folderName}" was added to your folders`);
            if (onDataUpdate) await onDataUpdate();
        }
        return true;
    } catch (error) {
        console.error('Error responding to shared invite:', error);
        showErrorToast('Could not respond to the invite. Please try again.');
        return false;
    }
}

/**
 * Complete a folder join that was stashed while the user was signed out
 * (share-link flow). The background handler clears the stash on success.
 * @param {object} stash - Pending join ({ token, name }).
 * @param {Function} [onDataUpdate] - Called after a successful join to refresh data.
 * @returns {Promise<boolean>} Whether the join succeeded.
 */
export async function joinSharedFolderLink(stash, onDataUpdate) {
    try {
        // First shared-folder interaction — ask for the optional notifications
        // permission (fire-and-forget; declining never blocks the flow).
        ensureNotificationsPermission();
        const res = await browser.runtime.sendMessage({ type: 'sharedJoinLink', token: stash.token });
        if (!res?.ok) {
            showErrorToast(res?.status === 'sign_in_required'
                ? 'Sign in with Google (Settings → Sync) first, then try again.'
                : 'Couldn\'t join the folder — the link may have been revoked.');
            return false;
        }
        showSuccessToast(`You joined "${res.name || stash.name}"`);
        if (onDataUpdate) await onDataUpdate();
        return true;
    } catch (error) {
        console.error('Error joining shared folder via link:', error);
        showErrorToast('Couldn\'t join the folder — please try again.');
        return false;
    }
}

/**
 * Stop sharing a folder the caller owns. Revokes every member's access;
 * keeps a local copy for the owner.
 * @param {object} folder - The folder record (must carry `uid`/`name`).
 * @param {Function} [onDataUpdate] - Called after a successful unshare to refresh data.
 * @returns {Promise<boolean>} Whether the unshare succeeded.
 */
export async function unshareSharedFolder(folder, onDataUpdate) {
    try {
        const res = await browser.runtime.sendMessage({ type: 'sharedUnshareFolder', folderId: folder.uid });
        if (!res?.ok) {
            showErrorToast('Couldn\'t stop sharing — please try again.');
            return false;
        }
        showInfoToast(`"${folder.name}" is no longer shared.`);
        if (onDataUpdate) await onDataUpdate();
        return true;
    } catch (error) {
        console.error('Error unsharing folder:', error);
        showErrorToast('Couldn\'t stop sharing — please try again.');
        return false;
    }
}

/**
 * Build the collections payload for sharing a folder (`sharedCreateShare`).
 *
 * Order-consistency contract: members can only ever see the same in-folder
 * order as the sharer if every collection carries an explicit sequential
 * `order` — without it, each device falls back to sorting by `lastUpdated`,
 * which is device-local (accepting an invite stamps every materialized
 * collection with the same Date.now(), flattening the order entirely). So
 * this captures the sharer's CURRENT display order (their active sort
 * settings, same mapping as App's getCurrentCollectionSortOptions), stamps
 * it as `order: 0..n` into both the uploaded payload and the sharer's own
 * local records (updateCollectionsOrder), freezing the folder into
 * explicit-order mode for everyone from the moment it is shared.
 *
 * Local-only fields (`parentId`, `lastOpened`) are stripped, mirroring the
 * sync engine's own push-phase whitelist.
 *
 * @param {string} folderUid - The folder being shared.
 * @returns {Promise<Array<{uid: string, data: object}>>} Payload for `sharedCreateShare`.
 */
export async function gatherCollectionsForShare(folderUid) {
    const index = await loadCollectionsIndex();
    const uids = Object.keys(index).filter((uid) => index[uid].parentId === folderUid);
    const records = await loadMultipleCollections(uids);
    const present = uids.map((uid) => records[uid]).filter(Boolean);

    const { currentSortValue, currentSortAscending } = await browser.storage.local.get(['currentSortValue', 'currentSortAscending']);
    const sortFieldMap = { DATE: 'lastUpdated', NAME: 'name', COLOR: 'color' };
    const sorted = sortCollectionsForDisplay(present, {
        sortBy: sortFieldMap[currentSortValue || 'DATE'] || 'lastUpdated',
        sortOrder: (currentSortAscending !== undefined ? currentSortAscending : true) ? 'asc' : 'desc',
    });

    // Persist the same order locally so the sharer's display can never drift
    // from what members were sent (a lastUpdated-sorted view re-shuffles as
    // collections are edited; an explicit order stays put on every device).
    await updateCollectionsOrder(sorted);

    return sorted.map((record, position) => {
        const data = { ...record, order: position };
        delete data.parentId;
        delete data.lastOpened;
        return { uid: record.uid, data };
    });
}
