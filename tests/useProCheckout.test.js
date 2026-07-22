/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';

jest.mock('../app/ai/browserSupport', () => ({
    isChromeBrowser: jest.fn(),
    getBrowserName: jest.fn().mockReturnValue('Brave'),
}));

import { isChromeBrowser } from '../app/ai/browserSupport';
import { browser } from '../static/globals';
import useProCheckout from '../app/useProCheckout';
import NonChromeProConfirmModal from '../app/NonChromeProConfirmModal';

function Harness({ ensureLogin }) {
    const startProCheckout = useProCheckout();
    return <button onClick={() => startProCheckout({ ensureLogin })}>Upgrade</button>;
}

function renderHarness(props = {}) {
    const store = createStore();
    render(
        <Provider store={store}>
            <Harness {...props} />
            <NonChromeProConfirmModal />
        </Provider>,
    );
}

const checkoutCalls = () =>
    browser.runtime.sendMessage.mock.calls.filter(([msg]) => msg.type === 'openProCheckout');

describe('useProCheckout + NonChromeProConfirmModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.runtime.sendMessage = jest.fn().mockResolvedValue(true);
    });

    test('on Chrome, goes straight to checkout with no confirmation', async () => {
        isChromeBrowser.mockReturnValue(true);
        renderHarness();
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(checkoutCalls()).toHaveLength(1));
        expect(screen.queryByText('Before you upgrade')).not.toBeInTheDocument();
    });

    test('on Chrome, retries checkout after login when ensureLogin is set', async () => {
        isChromeBrowser.mockReturnValue(true);
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'openProCheckout') return Promise.resolve(checkoutCalls().length > 1);
            if (msg.type === 'login') return Promise.resolve(true);
            return Promise.resolve(true);
        });
        renderHarness({ ensureLogin: true });
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(checkoutCalls()).toHaveLength(2));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login' });
    });

    test('on a non-Chrome browser, shows the Chrome-only confirmation first', async () => {
        isChromeBrowser.mockReturnValue(false);
        renderHarness();
        fireEvent.click(screen.getByText('Upgrade'));
        expect(await screen.findByText('Before you upgrade')).toBeInTheDocument();
        expect(screen.getByText(/only available on Google Chrome/)).toBeInTheDocument();
        expect(screen.getByText(/won't work in Brave/)).toBeInTheDocument();
        expect(checkoutCalls()).toHaveLength(0);
    });

    test('confirming proceeds to checkout and closes the modal', async () => {
        isChromeBrowser.mockReturnValue(false);
        renderHarness();
        fireEvent.click(screen.getByText('Upgrade'));
        fireEvent.click(await screen.findByText('Continue to checkout'));
        await waitFor(() => expect(checkoutCalls()).toHaveLength(1));
        await waitFor(() => expect(screen.queryByText('Before you upgrade')).not.toBeInTheDocument());
    });

    test('cancelling never reaches checkout', async () => {
        isChromeBrowser.mockReturnValue(false);
        renderHarness();
        fireEvent.click(screen.getByText('Upgrade'));
        fireEvent.click(await screen.findByText('Cancel'));
        await waitFor(() => expect(screen.queryByText('Before you upgrade')).not.toBeInTheDocument());
        expect(checkoutCalls()).toHaveLength(0);
    });
});
