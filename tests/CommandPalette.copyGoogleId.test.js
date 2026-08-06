/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const GOOGLE_ID = '16862212693501500597';

function renderPalette({ viewContext = 'popup' } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, viewContext);
    store.set(premiumEntitlementState, null);

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
                onOpenAiTool={jest.fn()}
                onManageSubscription={jest.fn()}
            />
        </Provider>,
    );
    return { store };
}

describe('CommandPalette — Copy Google Account ID action', () => {
    let writeText;

    beforeEach(() => {
        writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
    });

    test('hidden when signed out', async () => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
        renderPalette();
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'google id' } });
        expect(screen.queryByText('Copy Google Account ID')).not.toBeInTheDocument();
    });

    test('copies the id when signed in (popup)', async () => {
        browser.storage.local.get.mockImplementation(async () => ({
            theme: 'light',
            googleUser: { permissionId: GOOGLE_ID, emailAddress: 'gilgold13@gmail.com' },
        }));
        renderPalette();
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'google id' } });

        fireEvent.click(await screen.findByText('Copy Google Account ID'));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(GOOGLE_ID));
    });

    test('available in the full-page view (parity)', async () => {
        browser.storage.local.get.mockImplementation(async () => ({
            theme: 'light',
            googleUser: { permissionId: GOOGLE_ID, emailAddress: 'gilgold13@gmail.com' },
        }));
        renderPalette({ viewContext: 'fullpage' });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'copy google' } });
        expect(await screen.findByText('Copy Google Account ID')).toBeInTheDocument();
    });
});
