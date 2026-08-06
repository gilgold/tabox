/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import SettingsMenu from '../app/SettingsMenu';
import { SHOW_ONBOARDING_EVENT } from '../app/OnboardingGuide';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn().mockResolvedValue(undefined),
}));

describe('SettingsMenu — Show onboarding', () => {
    test('clicking the button closes the menu and dispatches the show-onboarding event', async () => {
        const listener = jest.fn();
        window.addEventListener(SHOW_ONBOARDING_EVENT, listener);

        await act(async () => {
            render(
                <Provider>
                    <SettingsMenu />
                </Provider>,
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        fireEvent.click(document.querySelector('.settings-button'));
        fireEvent.click(await screen.findByRole('button', { name: 'Show onboarding' }));

        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener(SHOW_ONBOARDING_EVENT, listener);
    });
});
