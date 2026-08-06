/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { browser } from '../static/globals';

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

import AIEnableModal from '../app/AIEnableModal';

describe('AIEnableModal', () => {
    beforeEach(() => {
        browser.storage.local.set.mockReset();
    });

    test('explains cloud processing before enabling', () => {
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        expect(screen.getByText(/DeepSeek V4 Flash/i)).toBeInTheDocument();
        expect(screen.getByText(/sent to OpenRouter for processing/i)).toBeInTheDocument();
    });

    test('enable writes the setting and closes', async () => {
        browser.storage.local.set.mockResolvedValue();
        const onClose = jest.fn();
        render(<AIEnableModal isOpen={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(browser.storage.local.set).toHaveBeenCalledWith({ chkTaboxAI: true }));
        expect(onClose).toHaveBeenCalled();
    });

    test('shows an error and re-enables the button when the save fails', async () => {
        browser.storage.local.set.mockRejectedValue(new Error('quota'));
        const onClose = jest.fn();
        render(<AIEnableModal isOpen={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(screen.getByText(/could not save the setting/i)).toBeInTheDocument());
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /enable tabox ai/i })).not.toBeDisabled();
    });

    test('cancel closes without enabling', () => {
        const onClose = jest.fn();
        render(<AIEnableModal isOpen={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onClose).toHaveBeenCalled();
        expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
});
