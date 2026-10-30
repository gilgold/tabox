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

describe('restart recovery setting parity', () => {
    beforeEach(() => {
        browser.storage.session = { get: jest.fn(), set: jest.fn() };
        browser.alarms = { ...browser.alarms, create: jest.fn(), clear: jest.fn() };
    });
    test.each(['popup', 'fullpage'])('opt-in is available in %s palette', async view => {
        browser.storage.local.get.mockResolvedValue({ chkResumeAutoUpdate: false });
        const store = createStore();
        store.set(commandPaletteOpenState, true);
        store.set(viewContextState, view);
        render(<Provider store={store}><CommandPalette collections={[]} folders={[]} folderNameMap={{}} /></Provider>);
        fireEvent.change(await screen.findByPlaceholderText('Search collections, actions, or settings...'), { target: { value: 'resume auto' } });
        fireEvent.click(await screen.findByText('Resume auto-update after browser restart'));
        await waitFor(() => expect(browser.storage.local.set).toHaveBeenCalledWith({ chkResumeAutoUpdate: true }));
    });
});
