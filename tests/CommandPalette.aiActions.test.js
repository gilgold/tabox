/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';

// Labels mirror the canonical AI_TOOLS registry (app/ai/aiTasks.js).
const AI_LABELS = [
    'Smart Tab Grouping',
    'Auto rename collections',
    'Auto-arrange into folders',
    'Duplicate-tab sweep',
    'Split a collection',
];

function renderPalette({ viewContext = 'popup', onOpenAiTool = jest.fn() } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, viewContext);

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

describe('CommandPalette AI actions', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
        browser.storage.local.set.mockClear();
    });

    test.each(['popup', 'fullpage'])('shows every AI tool in %s view (parity)', async (viewContext) => {
        renderPalette({ viewContext });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'ai' } });

        for (const label of AI_LABELS) {
            expect(await screen.findByText(label)).toBeInTheDocument();
        }
    });

    test('executing an AI action calls onOpenAiTool with its tool id', async () => {
        const onOpenAiTool = jest.fn();
        renderPalette({ viewContext: 'fullpage', onOpenAiTool });

        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');
        fireEvent.change(input, { target: { value: 'split a collection' } });

        const row = await screen.findByText('Split a collection');
        fireEvent.click(row);

        await waitFor(() => {
            expect(onOpenAiTool).toHaveBeenCalledWith('split-collection');
        });
    });
});
