import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPCurrentWindowCard from '../app/fullpage/FPCurrentWindowCard';
import { selectedCurrentWindowIdState } from '../app/atoms/globalAppSettingsState';
import { CURRENT_WINDOWS_ACCENT_COLOR } from '../app/fullpage/fpAccentColors';

const renderWithStore = (ui, selectedWindowId = null) => {
    const store = createStore();
    store.set(selectedCurrentWindowIdState, selectedWindowId);
    return render(<Provider store={store}>{ui}</Provider>);
};

describe('FPCurrentWindowCard', () => {
    beforeEach(() => {
        browser.windows.update = jest.fn().mockResolvedValue({ id: 7 });
        browser.tabs.update = jest.fn().mockResolvedValue({ id: 11 });
    });

    test('renders the shared card shell with current window-specific badge and status', () => {
        const windowSnapshot = {
            windowId: 7,
            name: 'Current Window',
            tabs: [{ uid: 'tab-1', favIconUrl: 'https://example.com/favicon.ico' }],
            chromeGroups: [],
            isCurrentWindow: true,
        };
        const { container } = renderWithStore(
            <FPCurrentWindowCard
                windowSnapshot={windowSnapshot}
                onSelect={jest.fn()}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
            />,
        );

        expect(container.querySelector('.fp-card.fp-current-window-card')).toHaveStyle(`--fp-current-windows-accent: ${CURRENT_WINDOWS_ACCENT_COLOR}`);
        expect(screen.getByText('Live Window')).toBeInTheDocument();
        expect(screen.getByText('Focused')).toBeInTheDocument();
    });

    test('routes click and hover actions to the correct handlers', () => {
        const onSelect = jest.fn();
        const onFocusWindow = jest.fn();
        const onSaveAsCollection = jest.fn();
        const onCloseWindow = jest.fn();
        const windowSnapshot = {
            windowId: 7,
            name: 'Current Window',
            tabs: [{ uid: 'tab-1', favIconUrl: 'https://example.com/favicon.ico' }],
            chromeGroups: [],
            isCurrentWindow: true,
        };

        renderWithStore(
            <FPCurrentWindowCard
                windowSnapshot={windowSnapshot}
                onSelect={onSelect}
                onFocusWindow={onFocusWindow}
                onSaveAsCollection={onSaveAsCollection}
                onCloseWindow={onCloseWindow}
            />,
        );

        fireEvent.click(screen.getByText('Current Window'));
        fireEvent.click(screen.getByText('Focus'));
        fireEvent.click(screen.getByText('Save'));
        fireEvent.click(screen.getByText('Close'));

        expect(onSelect).toHaveBeenCalledWith(windowSnapshot);
        expect(onFocusWindow).toHaveBeenCalledWith(windowSnapshot);
        expect(onSaveAsCollection).toHaveBeenCalledWith(windowSnapshot);
        expect(onCloseWindow).toHaveBeenCalledWith(windowSnapshot);
    });

    test('renders matching tabs in search mode and focuses the clicked live tab', async () => {
        const onSelect = jest.fn();
        const windowSnapshot = {
            windowId: 7,
            name: 'Current Window',
            tabs: [
                {
                    id: 11,
                    uid: 'tab-11',
                    title: 'GitHub Docs',
                    url: 'https://github.com/gilgold/tabox',
                    favIconUrl: 'https://example.com/favicon.ico',
                },
                {
                    id: 12,
                    uid: 'tab-12',
                    title: 'OpenAI Docs',
                    url: 'https://openai.com/docs',
                },
            ],
            chromeGroups: [],
            isCurrentWindow: true,
        };
        const { container } = renderWithStore(
            <FPCurrentWindowCard
                windowSnapshot={windowSnapshot}
                onSelect={onSelect}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                search="github"
            />,
        );

        expect(screen.getByText('1 tab match')).toBeInTheDocument();
        expect(container.querySelector('.fp-card-matching-tab-title')).toHaveTextContent('GitHub Docs');
        expect(container.querySelector('.fp-card-matching-tab-url')).toHaveTextContent('https://github.com/gilgold/tabox');

        fireEvent.click(container.querySelector('.fp-card-matching-tab'));

        await waitFor(() => {
            expect(browser.windows.update).toHaveBeenCalledWith(7, { focused: true });
        });
        expect(browser.tabs.update).toHaveBeenCalledWith(11, { active: true });
        expect(onSelect).not.toHaveBeenCalled();
    });
});
