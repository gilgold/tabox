import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SaveCollectionModal from '../app/fullpage/SaveCollectionModal';
import { Provider, createStore } from 'jotai';
import { getAllWindowsTabsAndGroups, getCurrentTabsAndGroups } from '../app/utils';
import { sidebarNavigationState } from '../app/atoms/fullpageState';
import { searchState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';

jest.mock('../app/utils', () => ({
    ...jest.requireActual('../app/utils'),
    getCurrentTabsAndGroups: jest.fn(),
    getAllWindowsTabsAndGroups: jest.fn(),
}));

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
}));

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: () => true }));
jest.mock('../app/ai/tasks/suggestCollectionName', () => ({ suggestCollectionName: jest.fn() }));
jest.mock('../app/ai/tasks/suggestFolderName', () => ({ suggestFolderName: jest.fn() }));

describe('SaveCollectionModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
        browser.runtime.sendMessage.mockResolvedValue({});
        getAllWindowsTabsAndGroups.mockResolvedValue({
            folder: { uid: 'folder-template', name: 'Workspace', color: '#ef4444', collapsed: true },
            collections: [
                { uid: 'collection-1', name: 'Workspace - Window 1', window: { id: 10 } },
                { uid: 'collection-2', name: 'Workspace - Window 2', window: { id: 20 } },
            ],
        });
        getCurrentTabsAndGroups.mockResolvedValue({ tabs: [{ title: 'React', url: 'https://react.dev' }] });
        suggestCollectionName.mockResolvedValue('React Learning');
    });

    test('closes with the selected folder saved while cloud sync is still pending', async () => {
        browser.runtime.sendMessage.mockImplementation(({ type }) => type === 'updateRemote' ? new Promise(() => {}) : Promise.resolve({}));
        const onClose = jest.fn();
        const addFolder = jest.fn().mockResolvedValue({ uid: 'folder-1' });
        const addCollection = jest.fn().mockResolvedValue(true);
        const onDataUpdate = jest.fn().mockResolvedValue(undefined);
        const onSaved = jest.fn();

        render(
            <SaveCollectionModal
                isOpen={true}
                onClose={onClose}
                folders={[]}
                addCollection={addCollection}
                addFolder={addFolder}
                onDataUpdate={onDataUpdate}
                onSaved={onSaved}
                initialSaveMode="all"
                lockSaveMode={true}
            />,
        );

        fireEvent.change(screen.getByLabelText('Folder Name'), {
            target: { value: 'Workspace' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Choose Red folder color' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save All Windows' }));

        await waitFor(() => {
            expect(getAllWindowsTabsAndGroups).toHaveBeenCalledWith('Workspace', '#ef4444');
        });

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'updateRemote' });
        expect(addFolder).toHaveBeenCalledWith('Workspace', '#ef4444', true);
        expect(addCollection).toHaveBeenCalledWith(
            expect.objectContaining({ parentId: 'folder-1' }),
            true,
            true,
            { sourceWindowId: 10 },
        );
        expect(addCollection).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'collection-2', parentId: 'folder-1' }),
            true, true, { sourceWindowId: 20 },
        );
        expect(onSaved).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ uid: 'collection-1', parentId: 'folder-1' }),
        ]));
    });

    test('suggests a collection name inside the Save Current Tabs modal', async () => {
        const store = createStore();
        store.set(premiumEntitlementState, { entitled: true, refreshedAt: new Date().toISOString() });
        render(
            <Provider store={store}>
                <SaveCollectionModal
                    isOpen={true}
                    onClose={jest.fn()}
                    folders={[]}
                    addCollection={jest.fn()}
                    addFolder={jest.fn()}
                />
            </Provider>,
        );

        fireEvent.click(screen.getByRole('button', { name: /suggest name with ai/i }));

        await waitFor(() => expect(screen.getByLabelText('Collection Name')).toHaveValue('React Learning'));
        expect(getCurrentTabsAndGroups).toHaveBeenCalledWith('');
        expect(suggestCollectionName).toHaveBeenCalledWith(expect.objectContaining({ tabs: expect.any(Array) }));
    });
});

describe('SaveCollectionModal failed current-window save', () => {
    test.each(['false', 'throw'])('retains the form without closing or announcing success on %s', async failure => {
        const { showSuccessToast, showErrorToast } = require('../app/toastHelpers');
        jest.clearAllMocks();
        getCurrentTabsAndGroups.mockResolvedValue({ uid: 'new', tabs: [] });
        const onClose = jest.fn();
        const onDataUpdate = jest.fn();
        const addCollection = failure === 'false' ? jest.fn().mockResolvedValue(false) : jest.fn().mockRejectedValue(new Error('Storage unavailable'));
        render(<SaveCollectionModal isOpen onClose={onClose} folders={[{ uid: 'project', name: 'Project' }]} addCollection={addCollection} onDataUpdate={onDataUpdate} />);
        fireEvent.change(screen.getByLabelText('Collection Name'), { target: { value: 'Reading' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Save To' }), { target: { value: 'proj' } });
        fireEvent.click(screen.getByRole('option', { name: 'Project' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Collection' }));
        await waitFor(() => expect(showErrorToast).toHaveBeenCalled());
        expect(onClose).not.toHaveBeenCalled();
        expect(onDataUpdate).not.toHaveBeenCalled();
        expect(showSuccessToast).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Collection Name')).toHaveValue('Reading');
        expect(screen.getByText('Project')).toBeInTheDocument();
    });
});


test('folder dropdown filters on typing, renders colored folder icons and selects with the keyboard', async () => {
    getCurrentTabsAndGroups.mockResolvedValue({ tabs: [{ title: 'React', url: 'https://react.dev' }], window: { id: 30 } });
    const addCollection = jest.fn().mockResolvedValue(true);
    const store = createStore();
    store.set(sidebarNavigationState, 'other-folder');
    store.set(searchState, 'old search');
    render(<Provider store={store}><SaveCollectionModal isOpen onClose={jest.fn()} folders={[
        { uid: 'work', name: 'Work', color: '#ef4444' },
        { uid: 'reading', name: 'Reading', color: '#1698e2' },
    ]} addCollection={addCollection} /></Provider>);
    const picker = screen.getByRole('combobox', { name: 'Save To' });
    fireEvent.focus(picker);
    fireEvent.keyDown(picker, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Work' }).querySelector('svg')).toHaveStyle({ color: '#ef4444' });
    fireEvent.change(picker, { target: { value: 'READ' } });
    expect(screen.queryByRole('option', { name: 'Work' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Reading' }).querySelector('svg')).toHaveStyle({ color: '#1698e2' });
    fireEvent.keyDown(picker, { key: 'Enter', code: 'Enter' });
    expect(addCollection).not.toHaveBeenCalled();
    expect(screen.getByText('Reading')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Collection Name'), { target: { value: 'Saved tabs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Collection' }));
    await waitFor(() => expect(addCollection).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'reading' }), false, true, { sourceWindowId: 30 }));
    await waitFor(() => expect(store.get(sidebarNavigationState)).toBe('all'));
    expect(store.get(searchState)).toBe('');
});
