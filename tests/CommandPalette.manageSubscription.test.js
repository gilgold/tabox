/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const PRO_RECORD = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };

function renderPalette({
    viewContext = 'popup',
    premium = null,
    onUpgradeToPro = jest.fn(),
    onManageSubscription = jest.fn(),
} = {}) {
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
                onUpgradeToPro={onUpgradeToPro}
                onManageSubscription={onManageSubscription}
            />
        </Provider>,
    );
    return { store, onUpgradeToPro, onManageSubscription };
}

describe('CommandPalette — Manage Subscription action', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
    });

    test('shows Upgrade to Pro for free users and triggers checkout', async () => {
        const { onUpgradeToPro, onManageSubscription } = renderPalette({ premium: null });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'subscription' } });

        fireEvent.click(await screen.findByText('Upgrade to Pro'));

        await waitFor(() => expect(onUpgradeToPro).toHaveBeenCalled());
        expect(onManageSubscription).not.toHaveBeenCalled();
        expect(screen.queryByText('Manage Subscription')).not.toBeInTheDocument();
    });

    test('visible for Pro users in the popup and triggers the handler', async () => {
        const { onUpgradeToPro, onManageSubscription } = renderPalette({ premium: PRO_RECORD });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'subscription' } });

        fireEvent.click(await screen.findByText('Manage Subscription'));
        await waitFor(() => expect(onManageSubscription).toHaveBeenCalled());
        expect(onUpgradeToPro).not.toHaveBeenCalled();
    });

    test('visible for Pro users in the full-page view (parity)', async () => {
        renderPalette({ premium: PRO_RECORD, viewContext: 'fullpage' });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'billing' } });
        expect(await screen.findByText('Manage Subscription')).toBeInTheDocument();
    });

    test('shows Upgrade to Pro for free users in the full-page view (parity)', async () => {
        renderPalette({ premium: null, viewContext: 'fullpage' });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'upgrade' } });
        expect(await screen.findByText('Upgrade to Pro')).toBeInTheDocument();
    });
});
