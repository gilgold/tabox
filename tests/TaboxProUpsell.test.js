/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
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
        expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument();
    });
});
