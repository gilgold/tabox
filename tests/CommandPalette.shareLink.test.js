/** @jest-environment jsdom */
// Command-palette parity for the collection "Share via Link" action: the
// shared COLLECTION_SUB_ACTIONS registry serves both popup and full-page
// palettes, so one entry covers both views (CLAUDE.md parity rule).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const COLLECTION = {
    uid: 'c-1',
    name: 'My Research',
    tabs: [{ url: 'https://example.com', title: 'Example' }],
};

function renderPalette({ viewContext = 'popup', onCollectionAction = jest.fn() } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, viewContext);
    store.set(premiumEntitlementState, null);

    render(
        <Provider store={store}>
            <CommandPalette
                collections={[COLLECTION]}
                folders={[]}
                folderNameMap={{}}
                onCreateFolder={jest.fn()}
                onImport={jest.fn()}
                onExportAll={jest.fn()}
                onOpenFullPage={jest.fn()}
                onRestoreSession={jest.fn()}
                onCollectionAction={onCollectionAction}
                onOpenAiTool={jest.fn()}
                onManageSubscription={jest.fn()}
                onShareFolder={jest.fn()}
            />
        </Provider>,
    );
    return { onCollectionAction };
}

beforeEach(() => {
    browser.storage.local.get.mockResolvedValue({ theme: 'light' });
});

test.each(['popup', 'fullpage'])('share-link sub-action appears and dispatches in the %s palette', async (viewContext) => {
    const { onCollectionAction } = renderPalette({ viewContext });
    const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

    fireEvent.change(input, { target: { value: COLLECTION.name } });
    fireEvent.click(await screen.findByText(COLLECTION.name));

    const shareBtn = await screen.findByText('Share via Link');
    fireEvent.click(shareBtn);

    await waitFor(() => expect(onCollectionAction).toHaveBeenCalledWith(COLLECTION, 'share-link'));
});
