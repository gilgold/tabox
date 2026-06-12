import { atom } from 'jotai';

// Whether the shared AI Tools modal is open (popup and full-page).
export const aiToolsModalOpenState = atom(false);

// What the AI Tools modal operates on. The header button resets this to
// 'all'; the full-page selection toolbar sets the checked collection uids.
export const aiToolsScopeState = atom({ type: 'all' });
