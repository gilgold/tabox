import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SaveCollectionModal from '../app/fullpage/SaveCollectionModal';
import { getAllWindowsTabsAndGroups } from '../app/utils';

jest.mock('../app/utils', () => ({
    ...jest.requireActual('../app/utils'),
    getCurrentTabsAndGroups: jest.fn(),
    getAllWindowsTabsAndGroups: jest.fn(),
}));

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
}));

describe('SaveCollectionModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
        browser.runtime.sendMessage.mockResolvedValue({});
        getAllWindowsTabsAndGroups.mockResolvedValue({
            folder: { uid: 'folder-template', name: 'Workspace', color: '#ef4444', collapsed: true },
            collections: [{ uid: 'collection-1', name: 'Workspace - Window 1' }],
        });
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
});
