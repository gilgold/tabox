import { atom } from 'jotai';

// Folder object currently open in the Share modal, or null when closed.
export const shareFolderModalState = atom(null);

// Whether the "you don't have permission" modal is open.
export const noPermissionOpenState = atom(false);

// Pending shared-folder invites surfaced to the current user (invite banner).
export const pendingInvitesState = atom([]);

// Pending share-link folder join stashed by the background while the user was
// signed out ({ token, name, ownerEmail, role } or null). Surfaced as a toast
// once the popup opens; cleared on join, dismiss, or background redemption.
export const pendingLinkJoinState = atom(null);

// Leave/Unshare confirmation modal (SharedActionConfirmModal): holds
// { kind: 'unshare' | 'leave', folder } while open, or null when closed.
// A single shared atom so every entry point (FolderContainer, FPSidebar,
// FPContentArea context menus) opens the SAME modal instance rendered once
// by App.js, instead of the action firing directly on menu click.
export const sharedActionConfirmState = atom(null);
