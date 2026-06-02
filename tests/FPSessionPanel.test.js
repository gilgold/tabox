/* global browser */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import FPSessionPanel from '../app/fullpage/FPSessionPanel';

describe('FPSessionPanel', () => {
    const sessionCollection = {
        uid: 'session-window-1',
        name: 'Saved Window',
        sessionId: 'window-session-1',
        sessionEntryKey: 'window:window-session-1',
        tabs: [
            {
                uid: 'tab-31',
                title: 'GitHub',
                url: 'https://github.com/gilgold/tabox',
                favIconUrl: 'https://github.com/favicon.ico',
                groupId: -1,
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

    test('renders session controls without live-window actions', () => {
        render(
            <FPSessionPanel
                sessionCollection={sessionCollection}
                sessionTimestamp={1710000000000}
                isOpen={true}
                onClose={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onRestoreWindow={jest.fn()}
            />,
        );

        expect(screen.getByText('Restore')).toBeInTheDocument();
        expect(screen.getByText('Recently Closed')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search 1 tab...')).toBeInTheDocument();
        expect(screen.queryByText('Focus Window')).not.toBeInTheDocument();
        expect(screen.queryByText('Live Window')).not.toBeInTheDocument();
    });

    test('restores the saved window through the browser runtime flow', async () => {
        const onRestoreWindow = jest.fn().mockResolvedValue(undefined);

        render(
            <FPSessionPanel
                sessionCollection={sessionCollection}
                sessionTimestamp={1710000000000}
                isOpen={true}
                onClose={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onRestoreWindow={onRestoreWindow}
            />,
        );

        fireEvent.click(screen.getByText('Restore'));

        await waitFor(() => {
            expect(browser.sessions.restore).toHaveBeenCalledWith('window-session-1');
        });
        expect(onRestoreWindow).toHaveBeenCalled();
    });

    test('opens a tab when clicking its visible url', async () => {
        render(
            <FPSessionPanel
                sessionCollection={sessionCollection}
                sessionTimestamp={1710000000000}
                isOpen={true}
                onClose={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onRestoreWindow={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'https://github.com/gilgold/tabox' }));

        await waitFor(() => {
            expect(browser.tabs.create).toHaveBeenCalledWith({
                url: 'https://github.com/gilgold/tabox',
                active: true,
            });
        });
    });
});
