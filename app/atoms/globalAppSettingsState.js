import { atom } from 'recoil';
import { browser } from '../../static/globals';

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

export const searchState = atom({
    key: 'search',
    default: undefined,
});

export const listKeyState = atom({
    key: 'listKey',
    default: 'key',
});

export const settingsDataState = atom({
    key: 'tabsArray',
    default: [],
    effects: [
        localStorageEffect('tabsArray'),
    ]
});