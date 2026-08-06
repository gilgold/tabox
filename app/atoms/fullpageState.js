import { atom } from 'jotai';

// Sidebar navigation: 'all' | 'unorganized' | 'current-windows' | 'sessions' | <folder-uid>
export const sidebarNavigationState = atom('all');

// Whether sidebar is collapsed (responsive)
export const sidebarCollapsedState = atom(false);

// Normalized recently closed browser sessions for the full-page view.
export const browserSessionsState = atom([]);

// Live current-window snapshots for the full-page view.
export const currentWindowsState = atom([]);
