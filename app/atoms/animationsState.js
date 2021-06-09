import { atom } from 'recoil';

export const rowToHighlightState = atom({
    key: 'rowToHighlightState',
    default: -1,
});