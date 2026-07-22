/** @jest-environment jsdom */
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));
jest.mock('../app/ai/browserSupport', () => ({
    getBrowserName: jest.fn().mockReturnValue('Brave'),
    isChromeBrowser: jest.fn().mockReturnValue(false),
}));

import { getAIAvailability } from '../app/ai/aiClient';
import AIUnavailableWarning from '../app/AIUnavailableWarning';

describe('AIUnavailableWarning', () => {
    beforeEach(() => {
        getAIAvailability.mockReset();
    });

    test('renders nothing while the availability check is pending', () => {
        getAIAvailability.mockReturnValue(new Promise(() => {}));
        render(<AIUnavailableWarning />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test.each(['available', 'downloadable', 'downloading'])(
        'renders nothing when availability is %s',
        async (state) => {
            getAIAvailability.mockResolvedValue(state);
            render(<AIUnavailableWarning />);
            await act(async () => {});
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        },
    );

    test('shows the hardware warning when the device is unavailable', async () => {
        getAIAvailability.mockResolvedValue('unavailable');
        render(<AIUnavailableWarning />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Tabox AI won't work on this computer.",
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            /22 GB free disk space and a supported GPU/,
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            /shared folders will still work/,
        );
    });

    test('shows the browser warning when the API is unsupported', async () => {
        getAIAvailability.mockResolvedValue('unsupported');
        render(<AIUnavailableWarning />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Tabox AI isn't supported in this browser.",
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            /requires Google Chrome 138 or newer/,
        );
    });

    test('shows the Chrome-only warning on a non-Chrome Chromium browser', async () => {
        getAIAvailability.mockResolvedValue('unsupported-browser');
        render(<AIUnavailableWarning />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Tabox AI is only available on Google Chrome.',
        );
        expect(screen.getByRole('alert')).toHaveTextContent(/You're using Brave/);
        expect(screen.getByRole('alert')).toHaveTextContent(/shared folders will still work/);
    });
});
