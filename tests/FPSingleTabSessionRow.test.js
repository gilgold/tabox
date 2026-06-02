/* global browser */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import FPSingleTabSessionRow from '../app/fullpage/FPSingleTabSessionRow';

describe('FPSingleTabSessionRow', () => {
    const collection = {
        uid: 'single-tab-session',
        name: 'Recently Closed Tab',
        sourceType: 'tab',
        sessionId: 'tab-session-1',
        sessionEntryKey: 'tab:tab-session-1',
        tabs: [
            {
                uid: 'tab-1',
                title: 'OpenAI Docs',
                url: 'https://openai.com/docs',
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
        browser.sessions.restore.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('renders a dedicated single-tab row with closed time and restores on row click', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 2, 27, 12, 0, 0));

        render(
            <FPSingleTabSessionRow
                collection={collection}
                sessionTimestamp={new Date(2026, 2, 27, 11, 0, 0).getTime()}
                onToggleSelected={jest.fn()}
                onSaveAsCollection={jest.fn()}
            />,
        );

        expect(screen.getByText('OpenAI Docs')).toBeInTheDocument();
        expect(screen.getByText('Tab')).toBeInTheDocument();
        expect(screen.getByText(/ago$/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select tab session' })).toBeInTheDocument();

        fireEvent.click(screen.getByText('OpenAI Docs'));

        await waitFor(() => {
            expect(browser.sessions.restore).toHaveBeenCalledWith('tab-session-1');
        });
    });

    test('keeps save and selection actions separate from restore', async () => {
        const onToggleSelected = jest.fn();
        const onSaveAsCollection = jest.fn();

        render(
            <FPSingleTabSessionRow
                collection={collection}
                sessionTimestamp={1710000000000}
                onToggleSelected={onToggleSelected}
                onSaveAsCollection={onSaveAsCollection}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Select tab session' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save as Collection' }));

        expect(onToggleSelected).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'single-tab-session' }),
            1710000000000,
        );
        expect(onSaveAsCollection).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'single-tab-session' }),
        );
        expect(browser.sessions.restore).not.toHaveBeenCalled();
    });
});
