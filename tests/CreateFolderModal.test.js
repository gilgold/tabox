import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CreateFolderModal from '../app/CreateFolderModal';

describe('CreateFolderModal edit mode', () => {
    test('closes immediately while folder updates continue in the background', () => {
        let resolveSave;
        const onSave = jest.fn(() => new Promise((resolve) => {
            resolveSave = resolve;
        }));
        const onClose = jest.fn();

        render(
            <CreateFolderModal
                isOpen={true}
                onClose={onClose}
                onSave={onSave}
                folder={{
                    uid: 'folder-1',
                    name: 'Work',
                    color: '#4facfe',
                }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSave).toHaveBeenCalledWith('Work', '#4facfe', 'folder-1');
        expect(onClose).toHaveBeenCalledTimes(1);

        resolveSave();
    });
});
