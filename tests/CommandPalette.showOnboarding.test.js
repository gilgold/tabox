/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { SHOW_ONBOARDING_EVENT } from '../app/OnboardingGuide';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

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

describe('CommandPalette — Show Onboarding action', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
    });

    test('dispatches the show-onboarding event from the popup palette', async () => {
        const listener = jest.fn();
        window.addEventListener(SHOW_ONBOARDING_EVENT, listener);

        renderPalette();
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'onboarding' } });
        fireEvent.click(await screen.findByText('Show Onboarding'));

        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener(SHOW_ONBOARDING_EVENT, listener);
    });

    test('available in the full-page view (parity)', async () => {
        renderPalette({ viewContext: 'fullpage' });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'welcome tour' } });
        expect(await screen.findByText('Show Onboarding')).toBeInTheDocument();
    });
});
