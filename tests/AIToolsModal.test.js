/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState } from '../app/atoms/aiState';

jest.mock('../app/ai/tasks/suggestCollectionName', () => ({
    suggestCollectionName: jest.fn(),
}));
jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllCollections: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';
import { loadAllCollections } from '../app/utils/storageUtils';
import AIToolsModal from '../app/AIToolsModal';

const renderOpenModal = async (updateCollection = jest.fn()) => {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    await act(async () => {
        render(
            <Provider store={store}>
                <AIToolsModal updateCollection={updateCollection} />
            </Provider>
        );
    });
    return store;
};

describe('AIToolsModal', () => {
    beforeEach(() => {
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', name: 'Untitled', tabs: [{ title: 'React Docs', url: 'https://react.dev' }] },
        ]);
        suggestCollectionName.mockReset();
    });

    test('lists the registered AI tools', async () => {
        await renderOpenModal();
        expect(screen.getByText('Auto-name collection')).toBeInTheDocument();
    });

    test('suggests and applies a new collection name', async () => {
        suggestCollectionName.mockResolvedValue('React Learning');
        const updateCollection = jest.fn();
        await renderOpenModal(updateCollection);

        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));

        await waitFor(() => expect(screen.getByDisplayValue('React Learning')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /apply/i }));
        await waitFor(() => expect(updateCollection).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'c1', name: 'React Learning' }),
            true,
        ));
    });

    test('shows an error when suggestion fails', async () => {
        suggestCollectionName.mockRejectedValue(new Error('boom'));
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));
        await waitFor(() => expect(screen.getByText(/could not generate/i)).toBeInTheDocument());
    });

    test('closes when the open atom is reset and excludes empty collections from the picker', async () => {
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', name: 'Has tabs', tabs: [{ title: 'A', url: 'https://a.dev' }] },
            { uid: 'c2', name: 'Empty', tabs: [] },
        ]);
        const store = await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        const select = screen.getByLabelText('Collection');
        expect([...select.options].some((o) => o.text.includes('Empty') && !o.disabled)).toBe(false);
        await act(async () => { store.set(aiToolsModalOpenState, false); });
        await waitFor(() => expect(screen.queryByText('Auto-name collection')).not.toBeInTheDocument());
    });
});
