import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, useSetAtom } from 'jotai';
import TabSwitcher from '../app/TabSwitcher';
import { tabSwitcherOpenState } from '../app/atoms/tabSwitcherState';

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
}));

function Harness() {
    const setOpen = useSetAtom(tabSwitcherOpenState);
    useEffect(() => { setOpen(true); }, [setOpen]);
    return <TabSwitcher />;
}

const renderOpenSwitcher = () => render(<Provider><Harness /></Provider>);

const seedWindows = (windows) => {
    browser.windows.getAll.mockResolvedValue(windows);
    browser.windows.getCurrent.mockResolvedValue({ id: 1 });
};

const twoWindowSeed = () => seedWindows([
    {
        id: 1, incognito: false, tabs: [
            { id: 11, title: 'Active Here', url: 'https://here.com', lastAccessed: 400, active: true, pinned: false, mutedInfo: { muted: false } },
            { id: 12, title: 'GitHub repo', url: 'https://github.com/x', lastAccessed: 300, active: false, pinned: false, mutedInfo: { muted: false } },
        ],
    },
    {
        id: 2, incognito: true, tabs: [
            { id: 21, title: 'Secret docs', url: 'https://secret.com', lastAccessed: 200, active: true, pinned: true, mutedInfo: { muted: true } },
        ],
    },
]);

describe('TabSwitcher', () => {
    beforeAll(() => {
        // jsdom doesn't implement scrollIntoView (used after arrow-key navigation).
        Element.prototype.scrollIntoView = jest.fn();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // jsdom's real window.close() tears down the environment's timers,
        // which hangs waitFor and jest's own test timeout — stub it.
        jest.spyOn(window, 'close').mockImplementation(() => {});
        browser.permissions = {
            contains: jest.fn().mockResolvedValue(false),
            request: jest.fn().mockResolvedValue(true),
        };
        browser.storage.session = {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        browser.tabs.update.mockResolvedValue({});
        browser.tabs.remove.mockResolvedValue();
        // windows.update isn't in the jest.setup.js browser mock — assign it here.
        browser.windows.update = jest.fn().mockResolvedValue({});
        browser.runtime.sendMessage.mockResolvedValue({});
    });

    test('renders all open tabs MRU-sorted with title, url, and window labels', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('Active Here');
        expect(rows[0]).toHaveTextContent('This window');
        expect(rows[2]).toHaveTextContent('Secret docs');
        expect(rows[2]).toHaveTextContent('Window 2');
        expect(rows[2]).toHaveTextContent('Incognito');
    });

    test('preselects the previous tab (row 1) when row 0 is the current active tab', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        await waitFor(() => expect(rows[1]).toHaveClass('selected'));
        expect(rows[0]).not.toHaveClass('selected');
    });

    test('typing filters the list and highlights matched text', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        fireEvent.change(screen.getByPlaceholderText('Jump to an open tab...'), { target: { value: 'github' } });
        const rows = await screen.findAllByTestId('tab-switcher-row');
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelectorAll('.tab-switcher-match').length).toBeGreaterThan(0);
    });

    test('shows the empty state for a non-matching query', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        fireEvent.change(screen.getByPlaceholderText('Jump to an open tab...'), { target: { value: 'zzz-nope' } });
        expect(await screen.findByText('No matching tabs')).toBeInTheDocument();
    });

    test('Enter activates the selected tab and focuses its window when remote', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        const input = screen.getByPlaceholderText('Jump to an open tab...');
        fireEvent.change(input, { target: { value: 'secret' } });
        await screen.findAllByTestId('tab-switcher-row');
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(21, { active: true }));
        expect(browser.windows.update).toHaveBeenCalledWith(2, { focused: true });
        // Switching to another window's tab dismisses the popup.
        expect(window.close).toHaveBeenCalled();
    });

    test('activating the current tab closes only the switcher, not the popup', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        // Row 0 (tab 11) is the active tab of the current window.
        fireEvent.click(rows[0]);
        await waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(11, { active: true }));
        expect(window.close).not.toHaveBeenCalled();
    });

    test('clicking a row activates that tab', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        fireEvent.click(rows[1]);
        await waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(12, { active: true }));
        // same window — no focus call needed
        expect(browser.windows.update).not.toHaveBeenCalled();
    });

    test('right-click opens the live-tab context menu with the full action set', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        fireEvent.contextMenu(rows[2]);
        expect(await screen.findByText('Switch to tab')).toBeInTheDocument();
        expect(screen.getByText('Copy URL')).toBeInTheDocument();
        expect(screen.getByText('Unpin tab')).toBeInTheDocument();   // seeded pinned: true
        expect(screen.getByText('Unmute tab')).toBeInTheDocument();  // seeded muted: true
        expect(screen.getByText('Move to new window')).toBeInTheDocument();
        expect(screen.getByText('Close tab')).toBeInTheDocument();
    });

    test('Close tab removes the tab and refreshes the list', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        fireEvent.contextMenu(rows[2]);
        fireEvent.click(await screen.findByText('Close tab'));
        await waitFor(() => expect(browser.tabs.remove).toHaveBeenCalledWith(21));
        expect(browser.windows.getAll.mock.calls.length).toBeGreaterThanOrEqual(2); // initial load + refresh
    });

    test('a list refresh from a context-menu action keeps the user\'s arrowed-to selection', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        let rows = await screen.findAllByTestId('tab-switcher-row');
        await waitFor(() => expect(rows[1]).toHaveClass('selected'));
        const input = screen.getByPlaceholderText('Jump to an open tab...');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        rows = await screen.findAllByTestId('tab-switcher-row');
        expect(rows[2]).toHaveClass('selected');
        // Trigger a refresh via the context menu: Pin tab on row 0.
        fireEvent.contextMenu(rows[0]);
        fireEvent.click(await screen.findByText('Pin tab'));
        await waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(11, { pinned: true }));
        // refreshEntries re-runs with the same seeded windows.
        await waitFor(() => expect(browser.windows.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
        // Flush the refresh promise chain and follow-up effects so a buggy
        // preselect re-run would have landed by now.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
        // Selection must NOT snap back to the initial preselect (row 1).
        await waitFor(() => {
            const refreshed = screen.getAllByTestId('tab-switcher-row');
            expect(refreshed[2]).toHaveClass('selected');
            expect(refreshed[1]).not.toHaveClass('selected');
        });
    });

    test('preview pane shows the fallback card and Enable tab previews without permission', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        expect(await screen.findByText('Enable tab previews')).toBeInTheDocument();
        expect(document.querySelector('.tab-switcher-preview-card')).toBeInTheDocument();
    });

    test('Enable tab previews requests <all_urls> and asks background to prime the cache', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        fireEvent.click(await screen.findByText('Enable tab previews'));
        await waitFor(() => expect(browser.permissions.request).toHaveBeenCalledWith({ origins: ['<all_urls>'] }));
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'captureAllWindows' }));
    });

    test('shows the cached thumbnail for the selected tab when permission is granted', async () => {
        twoWindowSeed();
        browser.permissions.contains.mockResolvedValue(true);
        browser.storage.session.get.mockImplementation(async (key) => (
            key === 'thumb_12' ? { thumb_12: { dataUrl: 'data:image/jpeg;base64,xyz', capturedAt: 1 } } : {}
        ));
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        // row 1 (tab 12) is preselected; preview is debounced 150ms
        await waitFor(() => {
            const img = document.querySelector('.tab-switcher-preview-shot');
            expect(img).toBeInTheDocument();
            expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,xyz');
        }, { timeout: 2000 });
    });
});
