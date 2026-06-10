/* global browser */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import FPSessionCard from '../app/fullpage/FPSessionCard';
import { selectedSessionEntryKeyState } from '../app/atoms/globalAppSettingsState';

const renderWithStore = (ui, selectedSessionEntryKey = null) => {
    const store = createStore();
    store.set(selectedSessionEntryKeyState, selectedSessionEntryKey);
    return render(<Provider store={store}>{ui}</Provider>);
};

describe('FPSessionCard', () => {
    const baseCollection = {
        uid: 'session-window-1',
        name: 'Saved Window',
        sessionId: 'window-session-1',
        sessionEntryKey: 'window:window-session-1',
        tabs: [
            {
                uid: 'tab-1',
                title: 'GitHub Docs',
                url: 'https://github.com/gilgold/tabox',
                favIconUrl: 'https://github.com/favicon.ico',
            },
            {
                uid: 'tab-2',
                title: 'OpenAI API',
                url: 'https://platform.openai.com/docs',
                favIconUrl: 'https://openai.com/favicon.ico',
            },
        ],
        chromeGroups: [],
    };

    beforeAll(() => {
        TimeAgo.addDefaultLocale(en);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        browser.sessions.restore.mockResolvedValue({ window: { sessionId: 'window-session-1' } });
        browser.tabs.create = jest.fn().mockResolvedValue({ id: 123 });
    });

    test('renders the shared card shell with session-specific badge and actions', () => {
        const { container } = renderWithStore(
            <FPSessionCard
                collection={baseCollection}
                sessionTimestamp={1710000000000}
                onSelect={jest.fn()}
                onSaveAsCollection={jest.fn()}
            />,
        );

        expect(container.querySelector('.fp-card.fp-session-card')).toBeInTheDocument();
        expect(screen.getByText('Recently closed')).toBeInTheDocument();
        expect(screen.getByText('Restore')).toBeInTheDocument();
        expect(screen.getByText('Save as Collection')).toBeInTheDocument();
    });

    test('renders matching tabs with highlighted title and url content in search mode', () => {
        const { container } = renderWithStore(
            <FPSessionCard
                collection={baseCollection}
                sessionTimestamp={1710000000000}
                onSelect={jest.fn()}
                onSaveAsCollection={jest.fn()}
                search="github"
            />,
        );

        expect(screen.getByText('1 tab match')).toBeInTheDocument();
        expect(container.querySelector('.fp-card-matching-tab-title')).toHaveTextContent('GitHub Docs');
        expect(container.querySelector('.fp-card-matching-tab-url')).toHaveTextContent('https://github.com/gilgold/tabox');
        expect(container.querySelector('.fp-card-matching-tab-title .fp-card-search-match')).toBeInTheDocument();
        expect(container.querySelector('.fp-card-matching-tab-url .fp-card-search-match')).toBeInTheDocument();
    });

    test('opens only the clicked matched tab without selecting the session card', async () => {
        const onSelect = jest.fn();

        const { container } = renderWithStore(
            <FPSessionCard
                collection={baseCollection}
                sessionTimestamp={1710000000000}
                onSelect={onSelect}
                onSaveAsCollection={jest.fn()}
                search="github"
            />,
        );

        fireEvent.click(container.querySelector('.fp-card-matching-tab'));

        await waitFor(() => {
            expect(browser.tabs.create).toHaveBeenCalledWith({
                url: 'https://github.com/gilgold/tabox',
                active: true,
            });
        });
        expect(onSelect).not.toHaveBeenCalled();
    });

    test('restores the full saved window in search mode', async () => {
        renderWithStore(
            <FPSessionCard
                collection={baseCollection}
                sessionTimestamp={1710000000000}
                onSelect={jest.fn()}
                onSaveAsCollection={jest.fn()}
                search="github"
            />,
        );

        fireEvent.click(screen.getByText('Restore'));

        await waitFor(() => {
            expect(browser.sessions.restore).toHaveBeenCalledWith('window-session-1');
        });
    });

    test('shows more and less controls for large match sets', () => {
        const collection = {
            ...baseCollection,
            tabs: Array.from({ length: 6 }, (_, index) => ({
                uid: `tab-${index + 1}`,
                title: `Match ${index + 1}`,
                url: `https://example.com/match-${index + 1}`,
            })),
        };

        const { container } = renderWithStore(
            <FPSessionCard
                collection={collection}
                sessionTimestamp={1710000000000}
                onSelect={jest.fn()}
                onSaveAsCollection={jest.fn()}
                search="match"
            />,
        );

        expect(screen.getByText('+ 1 more tab...')).toBeInTheDocument();
        expect(container.querySelectorAll('.fp-card-matching-tab')).toHaveLength(5);

        fireEvent.click(screen.getByText('+ 1 more tab...'));

        expect(screen.getByText('Show less')).toBeInTheDocument();
        expect(container.querySelectorAll('.fp-card-matching-tab')).toHaveLength(6);
    });
});
