import { atom } from 'recoil';
import { browser } from '../../static/globals';

export const isHighlightedState = atom({
    key: 'isHighlighted',
    default: false,
});

const localStorageEffect = (key) => async ({ onSet }) => {
    onSet(async newValue => {
        let obj = { [key]: newValue };
        await browser.storage.local.set(obj);
    });
};

export const themeState = atom({
    key: 'theme',
    default: [],
    effects: [
        localStorageEffect('theme'),
    ]
});

export const isLoggedInState = atom({
    key: 'isLoggedIn',
    default: false,
    effects: [
        localStorageEffect('isLoggedIn'),
    ]
});

export const syncInProgressState = atom({
    key: 'syncInProgressState',
    default: false,
});

export const lastSyncTimeState = atom({
    key: 'lastSyncTimeState',
    default: null,
});

export const showPickerState = atom({
    key: 'showPickerState',
    default: false,
});

export const searchState = atom({
    key: 'search',
    default: undefined,
});

export const listKeyState = atom({
    key: 'listKey',
    default: 'key',
});