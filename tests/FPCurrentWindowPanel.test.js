import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FPCurrentWindowPanel from '../app/fullpage/FPCurrentWindowPanel';

describe('FPCurrentWindowPanel', () => {
    const windowSnapshot = {
        windowId: 3,
        name: 'Current Window',
        tabs: [
            {
                id: 31,
                uid: 'tab-31',
                title: 'GitHub',
                url: 'https://github.com/gilgold/tabox',
                favIconUrl: 'https://github.com/favicon.ico',
                groupId: -1,
            },
        ],
        chromeGroups: [],
        isCurrentWindow: true,
        window: { id: 3 },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        browser.tabs.remove.mockResolvedValue(undefined);
        browser.tabs.create = jest.fn().mockResolvedValue({ id: 123 });
        browser.tabs.update = jest.fn().mockResolvedValue({ id: 31 });
        browser.windows.update = jest.fn().mockResolvedValue({ id: 3 });
    });

    test('renders restricted live-window controls without saved-collection editing actions', () => {
        render(
            <FPCurrentWindowPanel
                windowSnapshot={windowSnapshot}
                isOpen={true}
                onClose={jest.fn()}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                onTabsChanged={jest.fn()}
            />,
        );

        expect(screen.getByText('Focus Window')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search 1 tab...')).toBeInTheDocument();
        expect(screen.queryByText('Add Current Tab')).not.toBeInTheDocument();
        expect(screen.queryByText('Add All Tabs')).not.toBeInTheDocument();
        expect(screen.queryByText('Open group')).not.toBeInTheDocument();
        expect(screen.queryByText('Delete Collection')).not.toBeInTheDocument();
    });

    test('closes tabs immediately and refreshes the live window list', async () => {
        const onTabsChanged = jest.fn().mockResolvedValue(undefined);
        const { container } = render(
            <FPCurrentWindowPanel
                windowSnapshot={windowSnapshot}
                isOpen={true}
                onClose={jest.fn()}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                onTabsChanged={onTabsChanged}
            />,
        );

        fireEvent.click(container.querySelector('.current-window-tab-close-btn'));

        await waitFor(() => {
            expect(browser.tabs.remove).toHaveBeenCalledWith(31);
        });
        expect(onTabsChanged).toHaveBeenCalled();
    });

    test('opens a tab in the current window from the hover action', async () => {
        render(
            <FPCurrentWindowPanel
                windowSnapshot={windowSnapshot}
                isOpen={true}
                onClose={jest.fn()}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                onTabsChanged={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open' }));

        await waitFor(() => {
            expect(browser.tabs.create).toHaveBeenCalledWith({
                windowId: browser.windows.WINDOW_ID_CURRENT,
                url: 'https://github.com/gilgold/tabox',
                active: true,
            });
        });
    });

    test('focuses a tab in its source window from the hover action', async () => {
        const onTabsChanged = jest.fn().mockResolvedValue(undefined);
        render(
            <FPCurrentWindowPanel
                windowSnapshot={windowSnapshot}
                isOpen={true}
                onClose={jest.fn()}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                onTabsChanged={onTabsChanged}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Focus' }));

        await waitFor(() => {
            expect(browser.windows.update).toHaveBeenCalledWith(3, { focused: true });
        });
        expect(browser.tabs.update).toHaveBeenCalledWith(31, { active: true });
        expect(onTabsChanged).toHaveBeenCalled();
    });

    test('shows a right-click context menu with focus, open, and close actions', async () => {
        const onTabsChanged = jest.fn().mockResolvedValue(undefined);
        const onClose = jest.fn();
        const { container } = render(
            <FPCurrentWindowPanel
                windowSnapshot={windowSnapshot}
                isOpen={true}
                onClose={onClose}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                onTabsChanged={onTabsChanged}
            />,
        );

        fireEvent.contextMenu(screen.getByText('GitHub'));

        expect(screen.getByText('Focus Tab')).toBeInTheDocument();
        expect(screen.getByText('Open In Current Window')).toBeInTheDocument();
        expect(screen.getByText('Close Tab')).toBeInTheDocument();
        expect(container.querySelector('.current-window-tab-row-context-active')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByText('Close Tab'));

        await waitFor(() => {
            expect(browser.tabs.remove).toHaveBeenCalledWith(31);
        });
        expect(onTabsChanged).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    test('runs context menu open action without closing the panel', async () => {
        const onTabsChanged = jest.fn().mockResolvedValue(undefined);
        const onClose = jest.fn();
        render(
            <FPCurrentWindowPanel
                windowSnapshot={windowSnapshot}
                isOpen={true}
                onClose={onClose}
                onFocusWindow={jest.fn()}
                onSaveAsCollection={jest.fn()}
                onCloseWindow={jest.fn()}
                onTabsChanged={onTabsChanged}
            />,
        );

        fireEvent.contextMenu(screen.getByText('GitHub'));
        fireEvent.mouseDown(screen.getByText('Open In Current Window'));

        await waitFor(() => {
            expect(browser.tabs.create).toHaveBeenCalledWith({
                windowId: browser.windows.WINDOW_ID_CURRENT,
                url: 'https://github.com/gilgold/tabox',
                active: true,
            });
        });
        expect(onTabsChanged).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
