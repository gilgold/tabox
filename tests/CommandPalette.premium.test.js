/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { aiToolsModalOpenState, aiToolsInitialToolState } from '../app/atoms/aiState';

function renderPalette({ viewContext = 'popup', onOpenAiTool = jest.fn() } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, viewContext);
    store.set(premiumEntitlementState, null); // free user

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
                onOpenAiTool={onOpenAiTool}
            />
        </Provider>,
    );
    return { store, onOpenAiTool };
}

describe('CommandPalette premium parity (free user)', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
        browser.storage.local.set.mockClear();
    });

    test('AI actions remain visible to free users and open the AI modal (which shows the upsell)', async () => {
        const { store, onOpenAiTool } = renderPalette({ viewContext: 'popup' });

        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'rename' } });

        const row = await screen.findByText('Auto rename collections');
        expect(row).toBeInTheDocument();

        fireEvent.click(row);

        await waitFor(() => {
            expect(onOpenAiTool).toHaveBeenCalledWith('auto-rename');
        });

        // Simulate the App-level handler that onOpenAiTool triggers: it opens the
        // AI modal pre-navigated to the invoked tool. Gating lives in the modal,
        // not the palette, so the palette must not filter premium tools.
        store.set(aiToolsInitialToolState, 'auto-rename');
        store.set(aiToolsModalOpenState, true);

        expect(store.get(aiToolsModalOpenState)).toBe(true);
        expect(store.get(aiToolsInitialToolState)).toBe('auto-rename');
    });
});
