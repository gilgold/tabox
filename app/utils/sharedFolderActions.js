/**
 * Shared-folder Leave/Unshare actions.
 *
 * Lifted out of FolderContainer.js/FPSidebar.js/FPContentArea.js (which used
 * to each inline an identical sendMessage+toast+refresh block) so
 * SharedActionConfirmModal's Confirm button has ONE implementation to call,
 * regardless of which of the three menu entry points opened it.
 */
import { browser } from '../../static/globals';
import { showInfoToast, showErrorToast } from '../toastHelpers';

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
