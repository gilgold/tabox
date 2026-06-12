import { atom } from 'jotai';

// Whether the shared AI Tools modal is open (popup and full-page).
export const aiToolsModalOpenState = atom(false);

// What the AI Tools modal operates on. The header button resets this to
// 'all'; the full-page selection toolbar sets the checked collection uids.
// Variants:
//   { type: 'all' }                    — operate on every collection
//   { type: 'selected', uids: string[] } — operate only on the listed uids
export const aiToolsScopeState = atom({ type: 'all' });

// All collection uids currently being processed by an AI rename run (bulk or
// single). Card components read this to show the animated gradient ring.
export const aiProcessingUidsState = atom([]);

// The uid of the collection being renamed right now (the "active" card in a
// bulk run, or the single target for a panel rename). Drives the stronger
// ai-processing-current variant of the ring effect.
export const aiProcessingCurrentUidState = atom(null);
