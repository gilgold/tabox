/* global browser */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import { SessionsModal } from '../app/SessionsModal';

describe('SessionsModal', () => {
    const sessions = [
        {
            timestamp: 1710000000000,
            collections: [
                {
                    uid: 'session-window-1',
                    sessionId: 'window-session-1',
                    sessionEntryKey: 'window:window-session-1',
                    name: 'Recently closed window',
                    tabs: [
                        {
                            uid: 'tab-1',
                            title: 'OpenAI Docs',
                            url: 'https://openai.com/docs',
                        },
                    ],
                    chromeGroups: [],
                },
            ],
        },
    ];

    beforeAll(() => {
        TimeAgo.addDefaultLocale(en);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        browser.sessions.restore.mockResolvedValue({ window: { sessionId: 'window-session-1' } });
    });

    test('restores browser session entries through browser.sessions.restore', async () => {
        render(
            <SessionsModal
                isOpen={true}
                sessions={sessions}
                onClose={jest.fn()}
                addCollection={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByText('Restore'));

        await waitFor(() => {
            expect(browser.sessions.restore).toHaveBeenCalledWith('window-session-1');
        });
    });

    test('saves a recently closed item as a new collection snapshot', async () => {
        const addCollection = jest.fn().mockResolvedValue(true);

        render(
            <SessionsModal
                isOpen={true}
                sessions={sessions}
                onClose={jest.fn()}
                addCollection={addCollection}
            />,
        );

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(addCollection).toHaveBeenCalledTimes(1);
        });

        const savedCollection = addCollection.mock.calls[0][0];
        expect(savedCollection.uid).not.toBe('session-window-1');
        expect(savedCollection.sessionId).toBeUndefined();
        expect(savedCollection.tabs).toHaveLength(1);
    });
});
