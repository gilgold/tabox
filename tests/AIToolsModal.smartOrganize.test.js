/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState } from '../app/atoms/aiState';

jest.mock('../app/utils/storageUtils', () => ({ loadAllCollections: jest.fn().mockResolvedValue([]) }));
jest.mock('../app/ai/readWindowStructure', () => ({ readWindowStructure: jest.fn().mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 }) }));
jest.mock('../app/ai/aiClient', () => ({ getAIAvailability: jest.fn().mockResolvedValue('available') }));
jest.mock('../app/ai/tasks/smartOrganizeTabs', () => ({ smartOrganizeTabs: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showUndoToast: jest.fn(), showSuccessToast: jest.fn() }));
jest.mock('../app/ai/captureWindowSnapshot', () => ({ captureWindowSnapshot: jest.fn() }));

import AIToolsModal from '../app/AIToolsModal';
import { readWindowStructure } from '../app/ai/readWindowStructure';
import { smartOrganizeTabs } from '../app/ai/tasks/smartOrganizeTabs';
import { showUndoToast } from '../app/toastHelpers';
import { browser } from '../static/globals';
import { captureWindowSnapshot } from '../app/ai/captureWindowSnapshot';
import { loadAllCollections } from '../app/utils/storageUtils';

const openModal = async () => {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    await act(async () => {
        render(<Provider store={store}><AIToolsModal updateRemoteData={jest.fn()} /></Provider>);
    });
    return store;
};

test('renders Smart Organize as a featured hero card with a Flagship badge', async () => {
    await openModal();
    expect(screen.getByText('Smart Organize')).toBeInTheDocument();
    expect(screen.getByText(/flagship/i)).toBeInTheDocument();
    expect(document.querySelector('.ai-hero-card')).toBeInTheDocument();
});

describe('Smart Organize panel (popup)', () => {
    beforeEach(() => {
        browser.windows.getCurrent = jest.fn().mockResolvedValue({ id: 100 });
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true, groupsCreated: 2, tabsAdded: 5, skipped: 0 });
        readWindowStructure.mockResolvedValue({
            ungroupedTabs: [{ tabId: 1, title: 'A', url: 'https://a.com' }, { tabId: 2, title: 'B', url: 'https://b.com' }],
            existingGroups: [], eligibleCount: 2,
        });
        smartOrganizeTabs.mockResolvedValue({ newGroups: [{ name: 'Docs', color: 'blue', tabIds: [1, 2] }], additions: [], skippedTabIds: [] });
    });

    test('shows the ungrouped count, runs, applies, and fires the undo toast', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Organize'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /organize/i }));

        await waitFor(() => expect(smartOrganizeTabs).toHaveBeenCalled());
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'smartOrganizeApply', windowId: 100 })
        ));
        await waitFor(() => expect(showUndoToast).toHaveBeenCalled());
        expect(screen.getByText(/created 2 groups/i)).toBeInTheDocument();
    });

    test('disables run when there are no ungrouped tabs', async () => {
        readWindowStructure.mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 });
        await openModal();
        fireEvent.click(screen.getByText('Smart Organize'));
        await waitFor(() => expect(screen.getByText(/already grouped/i)).toBeInTheDocument());
    });

    test('"Save as collection" calls captureWindowSnapshot and persists grouped tabs', async () => {
        const updateRemoteData = jest.fn().mockResolvedValue(undefined);
        // Snapshot returned by captureWindowSnapshot includes grouped tabs
        captureWindowSnapshot.mockResolvedValue({
            tabs: [
                { id: 1, url: 'https://a.com', title: 'A', groupId: 10 },
                { id: 2, url: 'https://b.com', title: 'B', groupId: 10 },
                { id: 3, url: 'https://c.com', title: 'C', groupId: -1 },
            ],
            chromeGroups: [{ id: 10, title: 'Work', color: 'blue' }],
        });
        loadAllCollections.mockResolvedValue([]);

        const store = createStore();
        store.set(aiToolsModalOpenState, true);
        await act(async () => {
            render(<Provider store={store}><AIToolsModal updateRemoteData={updateRemoteData} /></Provider>);
        });

        // Navigate to smart-organize panel
        fireEvent.click(screen.getByText('Smart Organize'));
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());

        // Run organize
        fireEvent.click(screen.getByRole('button', { name: /organize/i }));
        await waitFor(() => expect(screen.getByText(/save as collection/i)).toBeInTheDocument());

        // Click save
        fireEvent.click(screen.getByText(/save as collection/i));

        await waitFor(() => expect(captureWindowSnapshot).toHaveBeenCalledWith(100));
        await waitFor(() => expect(updateRemoteData).toHaveBeenCalled());

        // The persisted collection should include grouped tabs (groupId 10)
        const [[savedCollections]] = updateRemoteData.mock.calls;
        const savedCollection = savedCollections[savedCollections.length - 1];
        expect(savedCollection.tabs.some((t) => t.groupId === 10)).toBe(true);
        expect(savedCollection.chromeGroups).toHaveLength(1);
        expect(savedCollection.chromeGroups[0].id).toBe(10);
    });
});
