import { browser } from '../../static/globals';
import { showSuccessToast, showInfoToast, showErrorToast } from '../toastHelpers';

// Written by the background after it redeems a share link on Firefox, where
// the join page can't message the extension (no externally_connectable): the
// background redeems the link itself and swaps the tab to the full page,
// which shows the result from this key.
export const SHARE_LINK_NOTICE_KEY = 'shareLinkNotice';

export function getShareLinkNoticeMessage(result = {}) {
    const name = result.name ? `"${result.name}"` : 'The shared item';
    if (result.status === 'joined') {
        return { kind: 'success', text: `You joined ${name}${result.roleDowngraded ? ' with view-only access (editing requires Tabox Pro)' : ''}.` };
    }
    if (result.status === 'added') return { kind: 'success', text: `${name} was added to your Tabox.` };
    if (result.status === 'sign_in_required') {
        return { kind: 'info', text: `Sign in to Tabox to join ${name} — it joins automatically once you do.` };
    }
    if (result.error === 'member_limit') return { kind: 'error', text: 'This folder is full (20 members max). Ask the owner to make room.' };
    if (result.error === 'already_owner') return { kind: 'info', text: 'This is your own share link — it’s already in your Tabox.' };
    if (result.status === 'invalid') return { kind: 'error', text: 'This share link is no longer valid.' };
    return { kind: 'error', text: 'Something went wrong opening this share link. Please try again.' };
}

export const initShareLinkNoticeWatcher = () => {
    const showPending = async () => {
        const stored = await browser.storage.local.get(SHARE_LINK_NOTICE_KEY);
        const notice = stored?.[SHARE_LINK_NOTICE_KEY];
        if (!notice) return;
        await browser.storage.local.remove(SHARE_LINK_NOTICE_KEY);
        const { kind, text } = getShareLinkNoticeMessage(notice);
        if (kind === 'success') showSuccessToast(text, 6000);
        else if (kind === 'info') showInfoToast(text, 8000);
        else showErrorToast(text);
    };
    showPending();

    const handleChange = (changes, areaName) => {
        if (areaName === 'local' && changes[SHARE_LINK_NOTICE_KEY]?.newValue) showPending();
    };
    browser.storage.onChanged.addListener(handleChange);
    return () => browser.storage.onChanged.removeListener(handleChange);
};
