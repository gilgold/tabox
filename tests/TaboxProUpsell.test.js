/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { browser } from '../static/globals';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));

import { getAIAvailability } from '../app/ai/aiClient';
import TaboxProUpsell from '../app/TaboxProUpsell';

describe('TaboxProUpsell — AI availability warning', () => {
    beforeEach(() => {
        browser.runtime.sendMessage.mockReset();
        browser.runtime.sendMessage.mockResolvedValue(null);
        getAIAvailability.mockReset();
    });

    test('warns before the CTA when the device cannot run Tabox AI', async () => {
        getAIAvailability.mockResolvedValue('unavailable');
        render(<TaboxProUpsell isSignedIn={false} onUpgrade={jest.fn()} onSignIn={jest.fn()} />);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Tabox AI won't work on this computer.");
        // The warning must precede the CTA in the DOM so it reads before the button.
        const cta = screen.getByRole('button', { name: /sign in with google/i });
        expect(alert.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('shows no warning when the device can run Tabox AI', async () => {
        getAIAvailability.mockResolvedValue('available');
        render(<TaboxProUpsell isSignedIn={false} onUpgrade={jest.fn()} onSignIn={jest.fn()} />);
        expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
