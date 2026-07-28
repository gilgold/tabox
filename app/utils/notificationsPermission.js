/**
 * Optional `notifications` permission — runtime request.
 *
 * v4.2 moved `notifications` from required `permissions` to
 * `optional_permissions` in chrome/manifest.json so the upgrade doesn't
 * hard-disable the extension pending user re-approval. The permission is now
 * requested lazily, from a user gesture in the popup, at the start of the
 * user's first shared-folder interaction (sharing a folder, creating a join
 * link, accepting an invite, redeeming a join link) — the flows whose invite
 * notifications are the only thing the permission powers.
 *
 * Fire-and-forget by design: callers must never block their flow on the
 * answer. If the user declines, everything still works via the in-app
 * banners; chrome/background.js and chrome/shared-folders.js tolerate the
 * `browser.notifications` namespace being absent.
 *
 * Re-prompt avoidance: `permissions.contains` gates the request, and Chrome
 * would otherwise re-show the dialog on every `request` call, so we also ask
 * at most once per popup session (module state resets when the popup closes).
 */
import { browser } from '../../static/globals';

let requestedThisSession = false;

export function ensureNotificationsPermission() {
    if (requestedThisSession) return;
    requestedThisSession = true;
    // Not awaited by callers — the flow must not depend on the outcome.
    (async () => {
        try {
            const granted = await browser.permissions.contains({ permissions: ['notifications'] });
            if (!granted) {
                await browser.permissions.request({ permissions: ['notifications'] });
            }
        } catch (error) {
            // e.g. no user gesture, or the API is unavailable — notifications
            // simply stay off; in-app banners cover the UX.
            console.warn('Notifications permission request skipped:', error);
        }
    })();
}
