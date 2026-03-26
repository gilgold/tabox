import { atom } from 'jotai';

// Jotai atoms are simpler - no keys needed, just default values
// Storage persistence is handled manually via updateRemoteData calls throughout the app

export const themeState = atom([]);

export const isLoggedInState = atom(false);

export const syncInProgressState = atom(false);

export const lastSyncTimeState = atom(null);

export const syncSessionStateState = atom({
    isEnabled: false,
    status: 'disabled',
    user: null,
    hasRefreshToken: false,
    error: null,
    lastCheckedAt: 0
});

export const searchState = atom(undefined);

export const listKeyState = atom('key');

export const settingsDataState = atom([]);

// Global tracking state change trigger - incremented whenever tracking state changes
// This allows components to react to tracking changes without adding individual storage listeners
export const trackingStateVersion = atom(0);

// Full-page view state
export const viewContextState = atom('popup'); // 'popup' | 'fullpage'
export const detailPanelOpenState = atom(false);
export const selectedCollectionUidState = atom(null);
export const selectedCurrentWindowIdState = atom(null);
export const selectedSessionEntryKeyState = atom(null);
