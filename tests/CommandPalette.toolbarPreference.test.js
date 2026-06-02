import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';

describe('CommandPalette toolbar launch preference', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({
            theme: 'light',
            chkShowBadge: false,
            chkPerformanceMode: false,
            chkToolbarIconOpensFullPage: false,
            chkIgnorePinned: false,
            chkIgnoreDuplicates: false,
            chkEnableTabDiscard: false,
            chkColEditIgnoreDuplicateTabs: false,
            chkColEditIgnoreDuplicateGroups: false,
            chkEnableAutoUpdate: false,
            chkAutoUpdateOnNewCollection: false,
            chkManualUpdateLinkCollection: false,
        });
        browser.storage.local.set.mockClear();
    });

    test('toggles the toolbar launch mode from the full-page command palette', async () => {
        const store = createStore();
        store.set(commandPaletteOpenState, true);
        store.set(viewContextState, 'fullpage');

        render(
            <Provider store={store}>
                <CommandPalette
                    collections={[]}
                    folders={[]}
                    folderNameMap={{}}
                    onCreateFolder={jest.fn()}
                    onImport={jest.fn()}
                    onExportAll={jest.fn()}
                    onOpenFullPage={jest.fn()}
                    onRestoreSession={jest.fn()}
                    onCollectionAction={jest.fn()}
                />
            </Provider>,
        );

        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'toolbar' } });

        const setting = await screen.findByText('When Opening Tabox Launch In');
        fireEvent.click(setting);

        await waitFor(() => {
            expect(browser.storage.local.set).toHaveBeenCalledWith({ chkToolbarIconOpensFullPage: true });
        });
    });
});
