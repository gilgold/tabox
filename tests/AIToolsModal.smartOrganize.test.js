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

import AIToolsModal from '../app/AIToolsModal';
import { readWindowStructure } from '../app/ai/readWindowStructure';
import { smartOrganizeTabs } from '../app/ai/tasks/smartOrganizeTabs';
import { showUndoToast } from '../app/toastHelpers';
import { browser } from '../static/globals';

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
});
