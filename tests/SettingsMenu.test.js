import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import SettingsMenu from '../app/SettingsMenu';
import { isLoggedInState, themeState } from '../app/atoms/globalAppSettingsState';
import { getAIAvailability } from '../app/ai/aiClient';

// Mock the AI client so these unrelated tests never touch the network.
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));

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
    browser.runtime.sendMessage.mockImplementation(async (message) => {
        switch (message?.type) {
            case 'getBackupOptions':
                return {
                    groups: [
                        {
                            key: 'auto',
                            title: 'Auto Backups',
                            items: [
                                {
                                    id: 'auto:0',
                                    source: 'auto',
                                    timestamp: 1710000000000,
                                    collectionCount: 2,
                                    folderCount: 1,
                                    canPreview: true,
                                    canSelectiveRestore: true,
                                    canOverwrite: true,
                                    previewType: 'full_export',
                                },
                            ],
                        },
                    ],
                };
            case 'getSyncLogs':
                return [];
            default:
                return undefined;
        }
    });

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

const settingsCss = fs.readFileSync(path.join(__dirname, '../app/SettingsMenu.css'), 'utf8');
const syncRecoveryCss = fs.readFileSync(path.join(__dirname, '../app/SyncDebugRecoveryPanel.css'), 'utf8');

describe('SettingsMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getAIAvailability.mockResolvedValue(undefined);
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

    test('promotes Tabox Pro with shared animated gradient styling in both modal variants', () => {
        const { container } = renderSettingsMenu({ variant: 'fullpage' });

        openSettings(container);

        const settingsNav = screen.getByLabelText('Settings categories');
        const firstCategory = settingsNav.querySelector('.fp-settings-sidebar-item');
        const proGradientRule = settingsCss.match(/(?:^|\n)\.fp-settings-sidebar-item\.tabox-pro-option > span\s*{[^}]+}/)?.[0] || '';

        expect(firstCategory).toHaveTextContent('Tabox Pro');
        expect(firstCategory).toHaveClass('tabox-pro-option');
        expect(proGradientRule).toContain('background-clip: text');
        expect(proGradientRule).toContain('color: transparent');
        expect(proGradientRule).toContain('animation: tabox-pro-gradient');
        expect(settingsCss).not.toContain('html.fullpage-mode .fp-settings-sidebar-item.tabox-pro-option > span');
        expect(settingsCss).toContain('@keyframes tabox-pro-gradient');
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
            ['Export All Collections', []],
            ['Recovery', []],
            ['Diagnostics', []],
        ];

        for (const [category, ids] of cases) {
            fireEvent.click(screen.getByRole('button', { name: category }));

            await waitFor(() => {
                ids.forEach((id) => {
                    expect(document.querySelector(`#${id}`)).toBeInTheDocument();
                });
            });
        }

        fireEvent.click(screen.getByRole('button', { name: 'Export All Collections' }));
        expect(await screen.findByText('Download a full backup of every collection and folder.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Export all collections & folders/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Recovery' }));
        expect(await screen.findByText('Recover from backups')).toBeInTheDocument();
        expect(await screen.findByText('Auto Backups')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
        expect(await screen.findByText('Sync Logs')).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: /Force Download from Server/i })).toBeInTheDocument();
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

    test('separates recovery from diagnostics in full-page local-only mode when signed out', async () => {
        const loggedOutView = renderSettingsMenu({ variant: 'fullpage', isLoggedIn: false });
        openSettings(loggedOutView.container);
        await screen.findByText('Switch Tabox between light and dark themes.');

        fireEvent.click(screen.getByRole('button', { name: 'Recovery' }));
        expect(await screen.findByText('Recover from backups')).toBeInTheDocument();
        expect(await screen.findByText('Auto Backups')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
        expect(await screen.findByText('Sync diagnostics are unavailable until you sign in to Google Drive.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Force Download from Server/i })).not.toBeInTheDocument();

        loggedOutView.unmount();

        const loggedInView = renderSettingsMenu({ variant: 'fullpage', isLoggedIn: true });
        openSettings(loggedInView.container);
        await screen.findByText('Switch Tabox between light and dark themes.');

        fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
        expect(await screen.findByRole('button', { name: /Force Download from Server/i })).toBeInTheDocument();
    });

    test('uses the settings modal and full category set in the popup', async () => {
        const { container } = renderSettingsMenu({ variant: 'popup' });

        openSettings(container);

        expect(await screen.findByText('Customize how Tabox saves, opens, and restores your collections.')).toBeInTheDocument();
        expect(document.querySelector('.custom-drawer')).not.toBeInTheDocument();
        expect(document.querySelector('.fp-settings-modal--popup')).toBeInTheDocument();
        expect(document.querySelector('.fp-settings-modal-shell--popup')).toBeInTheDocument();
        expect(document.querySelector('.fp-settings-modal-shell--popup .switch--manual-animation')).toBeInTheDocument();

        const settingsNav = screen.getByLabelText('Settings categories');
        const firstPopupCategory = settingsNav.querySelector('.fp-settings-sidebar-item');
        expect(firstPopupCategory).toHaveTextContent('Tabox Pro');
        expect(firstPopupCategory).toHaveClass('tabox-pro-option');
        expect(screen.getByRole('button', { name: 'Export All Collections' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Recovery' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeInTheDocument();
    });

    test('keeps every popup settings section independently navigable', async () => {
        const { container } = renderSettingsMenu({ variant: 'popup', isLoggedIn: true });

        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: 'Tabox Pro' }));
        await screen.findByText('Everything included');

        const cases = [
            ['General Settings', 'darkModeToggle'],
            ['When adding a collection', 'chkIgnorePinned'],
            ['When opening collections', 'chkEnableTabDiscard'],
            ['When editing collections', 'chkColEditIgnoreDuplicateTabs'],
            ['Auto update collections', 'chkEnableAutoUpdate'],
        ];

        for (const [category, settingId] of cases) {
            fireEvent.click(screen.getByRole('button', { name: category }));
            await waitFor(() => expect(document.querySelector(`#${settingId}`)).toBeInTheDocument());
        }

        fireEvent.click(screen.getByRole('button', { name: 'Export All Collections' }));
        expect(await screen.findByRole('button', { name: /Export all collections & folders/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Recovery' }));
        expect(await screen.findByText('Recover from backups')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
        expect(await screen.findByText('Sync Logs')).toBeInTheDocument();
    });

    test('keeps the shared two-column settings modal in the popup with compact constraints', () => {
        const popupModalRule = settingsCss.match(/\.fp-settings-modal--popup\s*{[^}]+}/)?.[0] || '';
        const popupShellRule = settingsCss.match(/\.fp-settings-modal-shell--popup\s*{[^}]+}/)?.[0] || '';
        const popupNavRule = settingsCss.match(/\.fp-settings-modal-shell--popup \.fp-settings-sidebar-nav\s*{[^}]+}/)?.[0] || '';
        const popupItemRule = settingsCss.match(/\.fp-settings-modal-shell--popup \.fp-settings-sidebar-item\s*{[^}]+}/)?.[0] || '';
        const popupContentRule = settingsCss.match(/\.fp-settings-modal-shell--popup \.fp-settings-main-content\s*{[^}]+}/)?.[0] || '';
        const proCss = fs.readFileSync(path.join(__dirname, '../app/TaboxProOverview.css'), 'utf8');
        const popupProLayoutRule = proCss.match(/\.fp-settings-modal-shell--popup \.fp-pro-overview--compact \.fp-pro-overview-layout\s*{[^}]+}/)?.[0] || '';

        expect(popupModalRule).toContain('width: calc(100vw - 12px)');
        expect(popupModalRule).toContain('height: calc(100vh - 12px)');
        expect(popupShellRule).toContain('grid-template-columns: 190px minmax(0, 1fr)');
        expect(popupShellRule).toContain('grid-template-rows: minmax(0, 1fr)');
        expect(popupNavRule).toContain('flex-direction: column');
        expect(popupNavRule).toContain('overflow-y: auto');
        expect(popupItemRule).toContain('width: 100%');
        expect(popupContentRule).toContain('padding: 12px 16px 18px');
        expect(popupProLayoutRule).toContain('grid-template-columns: 1fr');
    });

    test('applies PipelinePro styling to the full-page settings modal and controls', () => {
        const shellRule = settingsCss.match(/html\.fullpage-mode \.fp-settings-modal-shell\s*{[^}]+}/)?.[0] || '';
        const sidebarItemRule = settingsCss.match(/html\.fullpage-mode \.fp-settings-sidebar-item\s*{[^}]+}/)?.[0] || '';
        const activeSidebarRule = settingsCss.match(/html\.fullpage-mode \.fp-settings-sidebar-item\.active\s*{[^}]+}/)?.[0] || '';
        const itemCardRule = settingsCss.match(/html\.fullpage-mode \.fp-settings-item-card\s*{[^}]+}/)?.[0] || '';
        const buttonRule = settingsCss.match(/html\.fullpage-mode \.fp-settings-modal-shell \.menu-button,[\s\S]+?\.fp-settings-modal-shell \.close-button\s*{[^}]+}/)?.[0] || '';
        const switchTrackRule = settingsCss.match(/html\.fullpage-mode \.fp-settings-modal-shell \.switch-label:before\s*{[^}]+}/)?.[0] || '';

        expect(shellRule).toContain('background: var(--color-surface)');
        expect(shellRule).toContain('border-radius: var(--fp-radius-xl)');
        expect(shellRule).toContain('box-shadow: var(--fp-shadow-xl)');
        expect(sidebarItemRule).toContain('min-height: 44px');
        expect(sidebarItemRule).toContain('border-radius: var(--fp-radius-sm)');
        expect(activeSidebarRule).toContain('background: var(--color-selected-bg)');
        expect(itemCardRule).toContain('border: 1px solid var(--color-border)');
        expect(itemCardRule).toContain('border-radius: var(--fp-radius-md)');
        expect(buttonRule).toContain('min-height: 38px');
        expect(buttonRule).toContain('border-radius: var(--fp-radius-sm)');
        expect(switchTrackRule).toContain('width: 40px');
        expect(switchTrackRule).toContain('background: var(--color-surface-muted)');
    });

    test('applies PipelinePro styling to recovery and diagnostics surfaces opened from settings', () => {
        const panelSurfaceRule = syncRecoveryCss.match(/html\.fullpage-mode \.sync-recovery-header,[\s\S]+?\.sync-recovery-logs-panel\s*{[^}]+}/)?.[0] || '';
        const actionRule = syncRecoveryCss.match(/html\.fullpage-mode \.sync-recovery-primary-action,[\s\S]+?\.sync-recovery-icon-btn\s*{[^}]+}/)?.[0] || '';
        const searchRule = syncRecoveryCss.match(/html\.fullpage-mode \.sync-recovery-search-field\s*{[^}]+}/)?.[0] || '';
        const pickerShellRule = syncRecoveryCss.match(/html\.fullpage-mode \.sync-recovery-picker-shell\s*{[^}]+}/)?.[0] || '';

        expect(panelSurfaceRule).toContain('background: var(--color-surface)');
        expect(panelSurfaceRule).toContain('border-radius: var(--fp-radius-md)');
        expect(actionRule).toContain('min-height: 38px');
        expect(actionRule).toContain('border-radius: var(--fp-radius-sm)');
        expect(searchRule).toContain('height: 38px');
        expect(searchRule).toContain('border-radius: var(--fp-radius-sm)');
        expect(pickerShellRule).toContain('background: var(--color-surface)');
        expect(pickerShellRule).toContain('border-radius: var(--fp-radius-xl)');
    });
});
