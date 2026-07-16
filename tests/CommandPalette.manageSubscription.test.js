/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const PRO_RECORD = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };

function renderPalette({ viewContext = 'popup', premium = null, onManageSubscription = jest.fn() } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, viewContext);
    store.set(premiumEntitlementState, premium);

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
                onManageSubscription={onManageSubscription}
            />
        </Provider>,
    );
    return { store, onManageSubscription };
}

describe('CommandPalette — Manage Subscription action', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
    });

    test('hidden for free users', async () => {
        renderPalette({ premium: null });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'subscription' } });
        expect(screen.queryByText('Manage Subscription')).not.toBeInTheDocument();
    });

    test('visible for Pro users in the popup and triggers the handler', async () => {
        const { onManageSubscription } = renderPalette({ premium: PRO_RECORD });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'subscription' } });

        fireEvent.click(await screen.findByText('Manage Subscription'));
        await waitFor(() => expect(onManageSubscription).toHaveBeenCalled());
    });

    test('visible for Pro users in the full-page view (parity)', async () => {
        renderPalette({ premium: PRO_RECORD, viewContext: 'fullpage' });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'billing' } });
        expect(await screen.findByText('Manage Subscription')).toBeInTheDocument();
    });
});
