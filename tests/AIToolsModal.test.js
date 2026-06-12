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
    loadSingleCollection: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';
import { loadAllCollections, loadSingleCollection } from '../app/utils/storageUtils';
import AIToolsModal from '../app/AIToolsModal';

const COLLECTION_C1 = { uid: 'c1', name: 'Untitled', tabs: [{ title: 'React Docs', url: 'https://react.dev' }] };

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
        loadAllCollections.mockResolvedValue([{ ...COLLECTION_C1 }]);
        loadSingleCollection.mockResolvedValue({ ...COLLECTION_C1 });
        suggestCollectionName.mockReset();
    });

    test('lists the registered AI tools', async () => {
        await renderOpenModal();
        expect(screen.getByText('Auto-name collection')).toBeInTheDocument();
    });

    test('suggests and applies a new collection name', async () => {
        suggestCollectionName.mockResolvedValue('React Learning');
        const updateCollection = jest.fn().mockResolvedValue(undefined);
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

    // ── New tests ────────────────────────────────────────────────────────────

    test('double-apply guard: updateCollection called exactly once even if Apply clicked twice', async () => {
        suggestCollectionName.mockResolvedValue('Quick Name');
        // loadSingleCollection resolves immediately (default mock) but updateCollection hangs
        // so the second click arrives while the first apply is still in flight.
        let resolveApply;
        const pendingApply = new Promise((resolve) => { resolveApply = resolve; });
        const updateCollection = jest.fn(() => pendingApply);

        await renderOpenModal(updateCollection);
        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));
        await waitFor(() => expect(screen.getByDisplayValue('Quick Name')).toBeInTheDocument());

        const applyBtn = screen.getByRole('button', { name: /apply/i });
        // First click — kicks off the apply (loadSingleCollection resolves synchronously in mock)
        fireEvent.click(applyBtn);
        // Wait for isApplying to be set (button disabled)
        await waitFor(() => expect(applyBtn).toBeDisabled());
        // Second click — must be a no-op because button is disabled and isApplying is true
        fireEvent.click(applyBtn);

        // Resolve the pending apply
        await act(async () => { resolveApply(); });

        expect(updateCollection).toHaveBeenCalledTimes(1);
    });

    test('apply re-fetches fresh data and patches only name/lastUpdated', async () => {
        suggestCollectionName.mockResolvedValue('Fresh Name');
        // Fresh object has an extra tab not present in the open-time snapshot
        const freshCollection = {
            ...COLLECTION_C1,
            tabs: [
                { title: 'React Docs', url: 'https://react.dev' },
                { title: 'Extra Tab', url: 'https://extra.dev' },
            ],
            favorite: true,
        };
        loadSingleCollection.mockResolvedValue(freshCollection);

        const updateCollection = jest.fn().mockResolvedValue(undefined);
        await renderOpenModal(updateCollection);

        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));
        await waitFor(() => expect(screen.getByDisplayValue('Fresh Name')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /apply/i }));
        await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));

        const saved = updateCollection.mock.calls[0][0];
        // Must carry the fresh tabs and favorite flag
        expect(saved.tabs).toHaveLength(2);
        expect(saved.favorite).toBe(true);
        // Must patch name and lastUpdated
        expect(saved.name).toBe('Fresh Name');
        expect(saved.lastUpdated).toBeDefined();
    });

    test('apply on deleted collection: shows error, never calls updateCollection', async () => {
        suggestCollectionName.mockResolvedValue('Ghost Name');
        // Re-fetch returns null — collection was deleted
        loadSingleCollection.mockResolvedValue(null);

        const updateCollection = jest.fn();
        await renderOpenModal(updateCollection);

        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));
        await waitFor(() => expect(screen.getByDisplayValue('Ghost Name')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /apply/i }));
        await waitFor(() => expect(screen.getByText(/no longer exists/i)).toBeInTheDocument());

        expect(updateCollection).not.toHaveBeenCalled();
        // Modal stays open — the suggestion input is still visible
        expect(screen.getByDisplayValue('Ghost Name')).toBeInTheDocument();
    });

    test('stale suggest discarded when selection changes while in flight', async () => {
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', name: 'First', tabs: [{ title: 'A', url: 'https://a.dev' }] },
            { uid: 'c2', name: 'Second', tabs: [{ title: 'B', url: 'https://b.dev' }] },
        ]);

        let resolveFirst;
        // First call hangs; subsequent calls resolve immediately
        suggestCollectionName
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValue('Second Name');

        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));

        // Start suggest for c1
        fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));

        // While in flight, switch to c2 (bumps the token)
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c2' } });
        });

        // Now resolve the stale c1 suggest
        await act(async () => { resolveFirst('Stale Name'); });

        // The stale result must not appear
        expect(screen.queryByDisplayValue('Stale Name')).not.toBeInTheDocument();
    });
});
