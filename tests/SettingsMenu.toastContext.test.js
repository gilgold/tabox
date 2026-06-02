/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { isLoggedInState, themeState } from '../app/atoms/globalAppSettingsState';

const mockSetToastViewContext = jest.fn();

jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    setToastViewContext: (...args) => mockSetToastViewContext(...args),
}));

const SettingsMenu = require('../app/SettingsMenu').default;

const seedBrowserStorage = () => {
    browser.storage.local._data = {
        theme: 'light',
        chkEnableAutoUpdate: false,
        chkPerformanceMode: false,
    };

    browser.storage.local.get.mockImplementation(async (keys) => {
        if (typeof keys === 'string') {
            return { [keys]: browser.storage.local._data[keys] };
        }

        if (Array.isArray(keys)) {
            return keys.reduce((result, key) => {
                result[key] = browser.storage.local._data[key];
                return result;
            }, {});
        }

        return browser.storage.local._data;
    });

    browser.storage.local.set.mockImplementation(async (items) => {
        Object.assign(browser.storage.local._data, items);
    });
};

const renderSettingsMenu = (variant) => {
    seedBrowserStorage();

    const store = createStore();
    store.set(isLoggedInState, false);
    store.set(themeState, 'light');

    return render(
        <Provider store={store}>
            <SettingsMenu
                variant={variant}
                updateRemoteData={jest.fn()}
                applyDataFromServer={jest.fn()}
            />
        </Provider>,
    );
};

describe('SettingsMenu toast context', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('sets full-page toast context when rendered in the full-page settings surface', () => {
        renderSettingsMenu('fullpage');

        expect(mockSetToastViewContext).toHaveBeenCalledWith('fullpage');
    });

    test('sets popup toast context when rendered in the popup settings surface', () => {
        renderSettingsMenu('popup');

        expect(mockSetToastViewContext).toHaveBeenCalledWith('popup');
    });
});
