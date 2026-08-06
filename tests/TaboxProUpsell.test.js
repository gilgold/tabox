/** @jest-environment jsdom */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { browser } from '../static/globals';

import TaboxProUpsell from '../app/TaboxProUpsell';

describe('TaboxProUpsell', () => {
    beforeEach(() => {
        browser.runtime.sendMessage.mockReset();
        browser.runtime.sendMessage.mockResolvedValue(null);
    });

    test('signed-out users get the sign-in CTA and no warning banner', () => {
        render(<TaboxProUpsell isSignedIn={false} onUpgrade={jest.fn()} onSignIn={jest.fn()} />);
        expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('signed-in users get the upgrade CTA', () => {
        const onUpgrade = jest.fn();
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={onUpgrade} onSignIn={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start my free 7-day trial/i }));
        expect(onUpgrade).toHaveBeenCalledTimes(1);
    });

    test('highlights the AI and sharing benefits with clear trial terms', () => {
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={jest.fn()} onSignIn={jest.fn()} />);

        expect(screen.getByRole('heading', { name: 'Meet Tabox Pro' })).toBeInTheDocument();
        expect(screen.getByText('Work smarter. Share anything.')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Organize tabs in seconds' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Share folders & collections' })).toBeInTheDocument();
        expect(screen.getByText('7 days free')).toBeInTheDocument();
        expect(screen.getByText('Cancel anytime')).toBeInTheDocument();
        expect(document.querySelector('.pro-upsell-hero-image')).toHaveAttribute(
            'src',
            './images/tabox-pro-ai-sharing-hero.png'
        );
        expect(document.querySelector('.pro-upsell-hero-image')).toHaveAttribute('alt', '');
    });

    test('mount refresh forwards a real entitlement to onEntitlementRefreshed', async () => {
        const entitlement = { entitled: true, status: 'active', refreshedAt: new Date().toISOString() };
        browser.runtime.sendMessage.mockResolvedValue(entitlement);
        const onEntitlementRefreshed = jest.fn();
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={jest.fn()} onSignIn={jest.fn()} onEntitlementRefreshed={onEntitlementRefreshed} />);
        await waitFor(() => expect(onEntitlementRefreshed).toHaveBeenCalledWith(entitlement));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('authError from the mount refresh shows the session-expired state instead of the upgrade CTA', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ authError: true });
        const onEntitlementRefreshed = jest.fn();
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={jest.fn()} onSignIn={jest.fn()} onEntitlementRefreshed={onEntitlementRefreshed} />);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/session expired/i);
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
        expect(onEntitlementRefreshed).not.toHaveBeenCalled();
    });

    test('sign-in-again clears the expired state only after re-auth restores a usable entitlement', async () => {
        const entitlement = { entitled: true, status: 'active', refreshedAt: new Date().toISOString() };
        browser.runtime.sendMessage
            .mockResolvedValueOnce({ authError: true }) // mount refresh
            .mockResolvedValueOnce(entitlement);        // refresh after re-sign-in
        const onSignIn = jest.fn().mockResolvedValue(undefined);
        const onEntitlementRefreshed = jest.fn();
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={jest.fn()} onSignIn={onSignIn} onEntitlementRefreshed={onEntitlementRefreshed} />);
        const button = await screen.findByRole('button', { name: /sign in again/i });
        fireEvent.click(button);
        expect(onSignIn).toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        expect(onEntitlementRefreshed).toHaveBeenCalledWith(entitlement);
    });

    test('sign-in-again keeps the expired state when the refresh still reports authError', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ authError: true }); // mount + post-sign-in refresh
        const onSignIn = jest.fn().mockResolvedValue(undefined);
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={jest.fn()} onSignIn={onSignIn} />);
        const button = await screen.findByRole('button', { name: /sign in again/i });
        fireEvent.click(button);
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    });

    test('sign-in-again keeps the expired state when onSignIn rejects (cancelled sign-in), with no unhandled rejection', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ authError: true });
        const onSignIn = jest.fn().mockRejectedValue(new Error('user cancelled'));
        render(<TaboxProUpsell isSignedIn={true} onUpgrade={jest.fn()} onSignIn={onSignIn} />);
        const button = await screen.findByRole('button', { name: /sign in again/i });
        fireEvent.click(button);
        await waitFor(() => expect(onSignIn).toHaveBeenCalled());
        // Only the mount refresh ran — a rejected sign-in must not trigger a refresh.
        expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    });
});
