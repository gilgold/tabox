import { atom } from 'jotai';
import { detailPanelOpenState } from './globalAppSettingsState';

// Folder object currently open in the Share modal, or null when closed.
export const shareFolderModalState = atom(null);

// Whether the "you don't have permission" modal is open.
export const noPermissionOpenState = atom(false);

// Pending shared-folder invites surfaced to the current user (invite banner).
export const pendingInvitesState = atom([]);

// Collection currently open in the "Share collection via link" modal, or null.
export const shareCollectionLinkModalState = atom(null);

// Pending share-link folder join stashed by the background while the user was
// signed out ({ token, name, ownerEmail, role } or null). Surfaced as a toast
// once the popup opens; cleared on join, dismiss, or background redemption.
export const pendingLinkJoinState = atom(null);

// Session caches for the full-page shared-folder panel. Activity is keyed by
// folder uid; comments are keyed by folder uid + thread uid. Keeping these in
// atoms lets the panel remount without discarding the latest successful data.
export const sharedActivityCacheState = atom({});
export const sharedCommentsCacheState = atom({});

// Leave/Unshare confirmation modal (SharedActionConfirmModal): holds
// { kind: 'unshare' | 'leave', folder } while open, or null when closed.
// A single shared atom so every entry point (FolderContainer, FPSidebar,
// FPContentArea context menus) opens the SAME modal instance rendered once
// by App.js, instead of the action firing directly on menu click.
export const sharedActionConfirmState = atom(null);

// Full-page "Activity & comments" right-side panel (shared folders only).
// Write-through atom: opening the shared panel closes the collection detail
// panel so the two right-side panels stay mutually exclusive. The reverse
// direction (opening the detail panel closes this one) is enforced by an
// effect in FPLayout, since detailPanelOpenState is written from many places.
const sharedPanelOpenBaseState = atom(false);
export const sharedPanelOpenState = atom(
    (get) => get(sharedPanelOpenBaseState),
    (get, set, nextOpen) => {
        set(sharedPanelOpenBaseState, nextOpen);
        if (nextOpen) set(detailPanelOpenState, false);
    },
);
