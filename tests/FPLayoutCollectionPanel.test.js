import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPLayout from '../app/fullpage/FPLayout';
import { detailPanelOpenState, selectedCollectionUidState } from '../app/atoms/globalAppSettingsState';
import { browserSessionsState, currentWindowsState, sidebarNavigationState } from '../app/atoms/fullpageState';

jest.mock('../app/fullpage/FPTopBar', () => function MockFPTopBar() {
    return <div>Top Bar</div>;
});

jest.mock('../app/fullpage/FPSidebar', () => function MockFPSidebar() {
    return <div>Sidebar</div>;
});

jest.mock('../app/fullpage/FPContentArea', () => function MockFPContentArea() {
    return <div>Content Area</div>;
});

jest.mock('../app/CollectionDetailPanel', () => function MockCollectionDetailPanel({ collection }) {
    return <div>{collection.name}</div>;
});

jest.mock('../app/fullpage/SaveCollectionModal', () => function MockSaveCollectionModal() {
    return null;
});

jest.mock('../app/fullpage/CurrentWindowCloseModal', () => function MockCurrentWindowCloseModal() {
    return null;
});

jest.mock('../app/fullpage/FPCurrentWindowPanel', () => function MockFPCurrentWindowPanel() {
    return null;
});

jest.mock('../app/fullpage/FPSessionPanel', () => function MockFPSessionPanel() {
    return null;
});

const testCollection = {
    uid: 'collection-1',
    name: 'Pinned Research',
    tabs: [],
    chromeGroups: [],
};

const baseProps = {
    folders: [],
    collections: [testCollection],
    allCollections: [testCollection],
    logout: jest.fn(),
    applyDataFromServer: jest.fn(),
    updateRemoteData: jest.fn(),
    addCollection: jest.fn(),
    removeCollection: jest.fn(),
    updateCollection: jest.fn(),
    addFolder: jest.fn(),
    onFolderOptimisticUpdate: jest.fn(),
    onDataUpdate: jest.fn(),
    onFolderStateChange: jest.fn(),
    updateFolders: jest.fn(),
    triggerSync: jest.fn(),
    viewMode: 'grid',
    onViewModeChange: jest.fn(),
    onFiltersChange: jest.fn(),
    filters: {},
    hasActiveFilters: false,
    triggerFolderLightningEffect: jest.fn(),
    trackedCollectionUids: new Set(),
    listKey: 'layout-collection-panel-test',
};

const renderWithStore = () => {
    const store = createStore();
    store.set(sidebarNavigationState, 'all');
    store.set(detailPanelOpenState, false);
    store.set(selectedCollectionUidState, null);
    store.set(currentWindowsState, []);
    store.set(browserSessionsState, []);

    const view = render(
        <Provider store={store}>
            <FPLayout {...baseProps} />
        </Provider>,
    );

    return { store, ...view };
};

describe('FPLayout collection detail panel shell', () => {
    test('keeps the panel shell mounted so the layout can animate into the open state', async () => {
        const { container, store } = renderWithStore();
        const body = container.querySelector('.fp-body');
        const panelShell = container.querySelector('.fp-detail-panel');

        expect(body).not.toHaveClass('fp-body-panel-open');
        expect(panelShell).toBeInTheDocument();
        expect(screen.queryByText('Pinned Research')).not.toBeInTheDocument();

        await act(async () => {
            store.set(selectedCollectionUidState, testCollection.uid);
            store.set(detailPanelOpenState, true);
        });

        expect(body).toHaveClass('fp-body-panel-open');
        expect(container.querySelector('.fp-detail-panel')).toBe(panelShell);
        expect(screen.getByText('Pinned Research')).toBeInTheDocument();
    });
});
