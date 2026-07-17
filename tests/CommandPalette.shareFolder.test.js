/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette, { EXTENSION_ACTIONS } from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const PRO_RECORD = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };

const OWNED_SHARED_FOLDER = { uid: 'f-owner', name: 'Owned Shared Folder', shared: { folderId: 'f-owner', role: 'owner' } };
const WRITE_MEMBER_FOLDER = { uid: 'f-write', name: 'Write Member Folder', shared: { folderId: 'f-write', role: 'write' } };
const READ_MEMBER_FOLDER = { uid: 'f-read', name: 'Read Member Folder', shared: { folderId: 'f-read', role: 'read' } };
const UNSHARED_FOLDER = { uid: 'f-plain', name: 'Plain Folder' };

function renderPalette({ viewContext = 'popup', premium = PRO_RECORD, folders = [], onShareFolder = jest.fn() } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, viewContext);
    store.set(premiumEntitlementState, premium);

    render(
        <Provider store={store}>
            <CommandPalette
                collections={[]}
                folders={folders}
                folderNameMap={{}}
                onCreateFolder={jest.fn()}
                onImport={jest.fn()}
                onExportAll={jest.fn()}
                onOpenFullPage={jest.fn()}
                onRestoreSession={jest.fn()}
                onCollectionAction={jest.fn()}
                onOpenAiTool={jest.fn()}
                onManageSubscription={jest.fn()}
                onShareFolder={onShareFolder}
            />
        </Provider>,
    );
    return { store, onShareFolder };
}

describe('CommandPalette — Share Folder action', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
    });

    test('share-folder action is registered, Pro-gated, and present for both views', () => {
        const action = EXTENSION_ACTIONS.find((a) => a.id === 'share-folder');
        expect(action).toBeDefined();
        expect(action.proOnly).toBe(true);
        expect(action.keywords).toMatch(/share/);
        expect(action.viewGate).toBeUndefined(); // must NOT be view-bound — parity rule
    });

    test('hidden for free users', async () => {
        renderPalette({ premium: null });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'share' } });
        expect(screen.queryByText('Share Folder…')).not.toBeInTheDocument();
    });

    test('visible for Pro users in the popup', async () => {
        renderPalette({ premium: PRO_RECORD });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'share' } });
        expect(await screen.findByText('Share Folder…')).toBeInTheDocument();
    });

    test('visible for Pro users in the full-page view (parity)', async () => {
        renderPalette({ premium: PRO_RECORD, viewContext: 'fullpage' });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'share' } });
        expect(await screen.findByText('Share Folder…')).toBeInTheDocument();
    });

    test('picking a folder calls onShareFolder with the chosen folder, excluding non-owner member folders', async () => {
        const { onShareFolder } = renderPalette({
            folders: [OWNED_SHARED_FOLDER, WRITE_MEMBER_FOLDER, READ_MEMBER_FOLDER, UNSHARED_FOLDER],
        });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'share' } });
        fireEvent.click(await screen.findByText('Share Folder…'));

        // Non-owner member folders must not be pickable for sharing.
        expect(screen.queryByText('Write Member Folder')).not.toBeInTheDocument();
        expect(screen.queryByText('Read Member Folder')).not.toBeInTheDocument();

        // Owned (shared or unshared) folders are pickable.
        expect(await screen.findByText('Owned Shared Folder')).toBeInTheDocument();
        expect(screen.getByText('Plain Folder')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Plain Folder'));
        await waitFor(() => expect(onShareFolder).toHaveBeenCalledWith(UNSHARED_FOLDER));
    });
});
