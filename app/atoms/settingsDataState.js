import { atom } from 'recoil';
import { browser } from '../../static/index';

const localStorageEffect = () => ({onSet}) => {
    onSet(async (newValue) => {
        await browser.storage.local.set({tabsArray: newValue});
    });
};

export const settingsDataState = atom({
    key: 'tabsArray',
    default: [],
    effects_UNSTABLE: [
        localStorageEffect(),
    ]
});