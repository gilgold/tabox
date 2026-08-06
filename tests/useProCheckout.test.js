/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { browser } from '../static/globals';
import useProCheckout from '../app/useProCheckout';

function Harness({ ensureLogin }) {
    const startProCheckout = useProCheckout();
    return <button onClick={() => startProCheckout({ ensureLogin })}>Upgrade</button>;
}

const checkoutCalls = () =>
    browser.runtime.sendMessage.mock.calls.filter(([msg]) => msg.type === 'openProCheckout');

describe('useProCheckout', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.runtime.sendMessage = jest.fn().mockResolvedValue(true);
    });

    test('goes straight to checkout', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(checkoutCalls()).toHaveLength(1));
    });

    test('retries checkout after login when ensureLogin is set', async () => {
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'openProCheckout') return Promise.resolve(checkoutCalls().length > 1);
            if (msg.type === 'login') return Promise.resolve(true);
            return Promise.resolve(true);
        });
        render(<Harness ensureLogin />);
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(checkoutCalls()).toHaveLength(2));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login' });
    });

    test('does not retry when ensureLogin is not set', async () => {
        browser.runtime.sendMessage = jest.fn().mockResolvedValue(false);
        render(<Harness />);
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(checkoutCalls()).toHaveLength(1));
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'login' });
    });
});
