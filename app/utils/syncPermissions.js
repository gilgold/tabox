import { browser } from '../../static/globals';
import { requestSyncPermissions } from '../../chrome/sync-transport';
import { showErrorToast } from '../toastHelpers';

// Must be invoked directly from the click, before unrelated async work.
export async function requestSyncAccess() {
    try {
        await requestSyncPermissions(browser);
        return true;
    } catch (error) {
        showErrorToast(error.message);
        return false;
    }
}
