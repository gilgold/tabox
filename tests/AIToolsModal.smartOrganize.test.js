/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState } from '../app/atoms/aiState';

jest.mock('../app/utils/storageUtils', () => ({ loadAllCollections: jest.fn().mockResolvedValue([]) }));
jest.mock('../app/ai/readWindowStructure', () => ({ readWindowStructure: jest.fn().mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 }) }));
jest.mock('../app/ai/aiClient', () => ({ getAIAvailability: jest.fn().mockResolvedValue('available') }));

import AIToolsModal from '../app/AIToolsModal';

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
