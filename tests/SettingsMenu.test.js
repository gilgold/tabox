import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import SettingsMenu from '../app/SettingsMenu';
import { isLoggedInState, themeState } from '../app/atoms/globalAppSettingsState';

const seedBrowserStorage = (overrides = {}) => {
    browser.storage.local._data = {
        theme: 'light',
        chkEnableAutoUpdate: false,
        chkPerformanceMode: false,
        ...overrides,
    };

    browser.storage.local.get.mockImplementation(async (keys) => {
        if (!keys) {
            return browser.storage.local._data;
        }

        if (typeof keys === 'string') {
            return { [keys]: browser.storage.local._data[keys] };
        }

        if (Array.isArray(keys)) {
            return keys.reduce((result, key) => {
                result[key] = browser.storage.local._data[key];
                return result;
            }, {});
        }

        return Object.entries(keys).reduce((result, [key, fallback]) => {
            result[key] = browser.storage.local._data[key] ?? fallback;
            return result;
        }, {});
    });

    browser.storage.local.set.mockImplementation(async (items) => {
        Object.assign(browser.storage.local._data, items);
    });
};

const renderSettingsMenu = ({ variant = 'popup', isLoggedIn = false, storageData = {} } = {}) => {
    seedBrowserStorage(storageData);
    browser.runtime.sendMessage.mockResolvedValue();

    const store = createStore();
    store.set(isLoggedInState, isLoggedIn);
    store.set(themeState, storageData.theme || 'light');

    const view = render(
        <Provider store={store}>
            <SettingsMenu
                variant={variant}
                updateRemoteData={jest.fn()}
                applyDataFromServer={jest.fn()}
            />
        </Provider>,
    );

    return { ...view, store };
};

const openSettings = (container) => {
    fireEvent.click(container.querySelector('.settings-button'));
};

describe('SettingsMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renders the full-page variant as a modal with sidebar categories', async () => {
        const { container } = renderSettingsMenu({ variant: 'fullpage' });

        openSettings(container);

        expect(await screen.findByText('Customize how Tabox saves, opens, and restores your collections.')).toBeInTheDocument();
        expect(document.querySelector('.fp-settings-modal-shell')).toBeInTheDocument();
        expect(document.querySelector('.custom-drawer')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'General Settings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'When opening collections' })).toBeInTheDocument();
        expect(screen.getByText('Switch Tabox between light and dark themes.')).toBeInTheDocument();
        expect(document.querySelector('.fp-settings-item-control .switch--manual-animation')).toBeInTheDocument();
    });

    test('switches the active full-page category and keeps the matching settings ids', async () => {
        const { container } = renderSettingsMenu({ variant: 'fullpage', isLoggedIn: true });

        openSettings(container);
        await screen.findByText('Switch Tabox between light and dark themes.');

        const cases = [
            ['General Settings', ['darkModeToggle', 'chkShowBadge', 'chkPerformanceMode', 'chkToolbarIconOpensFullPage']],
            ['When adding a collection', ['chkIgnorePinned']],
            ['When opening collections', ['chkIgnoreDuplicates', 'chkEnableTabDiscard']],
            ['When editing collections', ['chkColEditIgnoreDuplicateTabs', 'chkColEditIgnoreDuplicateGroups']],
            ['Auto update collections', ['chkEnableAutoUpdate', 'chkAutoUpdateOnNewCollection', 'chkManualUpdateLinkCollection']],
        ];

        for (const [category, ids] of cases) {
            fireEvent.click(screen.getByRole('button', { name: category }));

            await waitFor(() => {
                ids.forEach((id) => {
                    expect(document.querySelector(`#${id}`)).toBeInTheDocument();
                });
            });
        }

        fireEvent.click(screen.getByRole('button', { name: 'Backup & Restore' }));
        expect(await screen.findByText('Download a full backup of every collection and folder.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Export all collections & folders/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Sync Debug & Recovery/i })).toBeInTheDocument();
    });

    test('shows helper descriptions and preserves auto-update disabled states in full-page view', async () => {
        const { container } = renderSettingsMenu({
            variant: 'fullpage',
            storageData: { chkEnableAutoUpdate: false },
        });

        openSettings(container);
        await screen.findByText('Switch Tabox between light and dark themes.');

        fireEvent.click(screen.getByRole('button', { name: 'When opening collections' }));
        expect(await screen.findByText('Delay non-essential tabs until you activate them so large restores open more smoothly.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Auto update collections' }));

        await waitFor(() => {
            expect(document.querySelector('#chkAutoUpdateOnNewCollection')).toBeDisabled();
            expect(document.querySelector('#chkManualUpdateLinkCollection')).toBeDisabled();
        });
    });

    test('keeps sync debug hidden unless the user is logged in', async () => {
        const loggedOutView = renderSettingsMenu({ variant: 'fullpage', isLoggedIn: false });
        openSettings(loggedOutView.container);
        await screen.findByText('Switch Tabox between light and dark themes.');

        fireEvent.click(screen.getByRole('button', { name: 'Backup & Restore' }));
        expect(screen.queryByRole('button', { name: /Sync Debug & Recovery/i })).not.toBeInTheDocument();

        loggedOutView.unmount();

        const loggedInView = renderSettingsMenu({ variant: 'fullpage', isLoggedIn: true });
        openSettings(loggedInView.container);
        await screen.findByText('Switch Tabox between light and dark themes.');

        fireEvent.click(screen.getByRole('button', { name: 'Backup & Restore' }));
        expect(await screen.findByRole('button', { name: /Sync Debug & Recovery/i })).toBeInTheDocument();
    });

    test('keeps the popup variant on the existing drawer layout', async () => {
        const { container } = renderSettingsMenu({ variant: 'popup' });

        openSettings(container);

        expect(await screen.findByText('General Settings')).toBeInTheDocument();
        expect(document.querySelector('.custom-drawer.open')).toBeInTheDocument();
        expect(document.querySelector('.fp-settings-modal-shell')).not.toBeInTheDocument();
        expect(document.querySelector('.custom-drawer .switch--manual-animation')).not.toBeInTheDocument();
        expect(screen.getByText('When editing collections')).toBeInTheDocument();
        expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
    });
});
