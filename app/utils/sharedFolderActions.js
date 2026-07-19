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
