/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { browser } from '../static/globals';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
    downloadModel: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

import { getAIAvailability, downloadModel } from '../app/ai/aiClient';
import AIEnableModal from '../app/AIEnableModal';

describe('AIEnableModal', () => {
    beforeEach(() => {
        browser.storage.local.set.mockReset();
        getAIAvailability.mockReset();
        downloadModel.mockReset();
    });

    test('shows the system requirements', () => {
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        expect(screen.getByText(/22 GB of free disk space/i)).toBeInTheDocument();
        expect(screen.getByText(/never leave your computer/i)).toBeInTheDocument();
    });

    test('enables directly when the model is already available', async () => {
        getAIAvailability.mockResolvedValue('available');
        const onClose = jest.fn();
        render(<AIEnableModal isOpen={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(browser.storage.local.set).toHaveBeenCalledWith({ chkTaboxAI: true }));
        expect(downloadModel).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    test('downloads the model first when downloadable', async () => {
        getAIAvailability.mockResolvedValue('downloadable');
        downloadModel.mockResolvedValue();
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(downloadModel).toHaveBeenCalled());
        await waitFor(() => expect(browser.storage.local.set).toHaveBeenCalledWith({ chkTaboxAI: true }));
    });

    test('shows an error and does not enable on unsupported devices', async () => {
        getAIAvailability.mockResolvedValue('unavailable');
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(screen.getByText(/does not meet the requirements/i)).toBeInTheDocument());
        expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
});
