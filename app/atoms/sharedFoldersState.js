import { atom } from 'jotai';

// Folder object currently open in the Share modal, or null when closed.
export const shareFolderModalState = atom(null);

// Whether the "you don't have permission" modal is open.
export const noPermissionOpenState = atom(false);

// Pending shared-folder invites surfaced to the current user (invite banner).
export const pendingInvitesState = atom([]);
