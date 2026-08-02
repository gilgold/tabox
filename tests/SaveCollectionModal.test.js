import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SaveCollectionModal from '../app/fullpage/SaveCollectionModal';
import { Provider, createStore } from 'jotai';
import { getAllWindowsTabsAndGroups, getCurrentTabsAndGroups } from '../app/utils';
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
            collections: [{ uid: 'collection-1', name: 'Workspace - Window 1' }],
        });
        getCurrentTabsAndGroups.mockResolvedValue({ tabs: [{ title: 'React', url: 'https://react.dev' }] });
        suggestCollectionName.mockResolvedValue('React Learning');
    });

    test('passes the selected folder color when saving all windows', async () => {
        const addFolder = jest.fn().mockResolvedValue({ uid: 'folder-1' });
        const addCollection = jest.fn().mockResolvedValue(true);
        const onDataUpdate = jest.fn().mockResolvedValue(undefined);
        const onSaved = jest.fn();

        render(
            <SaveCollectionModal
                isOpen={true}
                onClose={jest.fn()}
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

        expect(addFolder).toHaveBeenCalledWith('Workspace', '#ef4444', true);
        expect(addCollection).toHaveBeenCalledWith(
            expect.objectContaining({ parentId: 'folder-1' }),
            true,
            true,
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
