/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({ isAISupported: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn() }));
jest.mock('../app/utils/storageUtils', () => ({ loadAllCollections: jest.fn() }));
jest.mock('../app/ai/tasks/suggestFolderName', () => ({ suggestFolderName: jest.fn() }));

import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';
import { isAISupported } from '../app/ai/aiClient';
import { loadAllCollections } from '../app/utils/storageUtils';
import { suggestFolderName } from '../app/ai/tasks/suggestFolderName';
import CreateFolderModal from '../app/CreateFolderModal';

describe('CreateFolderModal AI suggest', () => {
    beforeEach(() => {
        useTaboxAIEnabled.mockReturnValue(true);
        isAISupported.mockReturnValue(true);
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', name: 'A', parentId: 'f1', tabs: [{ title: 'T', url: 'https://e.com' }] },
            { uid: 'c2', name: 'B', parentId: 'other', tabs: [] },
        ]);
        suggestFolderName.mockReset();
    });

    test('button is disabled in create mode (no folder)', async () => {
        await act(async () => {
            render(<CreateFolderModal isOpen onClose={jest.fn()} onSave={jest.fn()} />);
        });
        expect(screen.getByRole('button', { name: /suggest name with ai/i })).toBeDisabled();
    });

    test('suggests a folder name from its collections in edit mode', async () => {
        suggestFolderName.mockResolvedValue('Frontend Docs');
        await act(async () => {
            render(<CreateFolderModal isOpen onClose={jest.fn()} onSave={jest.fn()} folder={{ uid: 'f1', name: 'Old' }} />);
        });
        const button = screen.getByRole('button', { name: /suggest name with ai/i });
        await waitFor(() => expect(button).not.toBeDisabled());
        fireEvent.click(button);
        await waitFor(() => expect(screen.getByDisplayValue('Frontend Docs')).toBeInTheDocument());
        expect(suggestFolderName).toHaveBeenCalledWith({ collections: [expect.objectContaining({ uid: 'c1' })] });
    });
});
