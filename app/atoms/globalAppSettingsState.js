import { atom } from 'jotai';

// Jotai atoms are simpler - no keys needed, just default values
// Storage persistence is handled manually via updateRemoteData calls throughout the app

export const themeState = atom([]);

export const isLoggedInState = atom(false);

export const syncInProgressState = atom(false);

export const lastSyncTimeState = atom(null);

export const searchState = atom(undefined);

export const listKeyState = atom('key');

export const settingsDataState = atom([]);

// Global tracking state change trigger - incremented whenever tracking state changes
// This allows components to react to tracking changes without adding individual storage listeners
export const trackingStateVersion = atom(0);