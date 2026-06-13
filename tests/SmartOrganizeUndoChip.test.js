/** @jest-environment jsdom */
// tests/SmartOrganizeUndoChip.test.js
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { browser } from '../static/globals';
import SmartOrganizeUndoChip from '../app/SmartOrganizeUndoChip';

describe('SmartOrganizeUndoChip', () => {
    beforeEach(() => {
        browser.storage.local.get = jest.fn();
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true });
        browser.storage.local.remove = jest.fn().mockResolvedValue();
        globalThis.LanguageModel = { availability: jest.fn() };
    });
    afterEach(() => { delete globalThis.LanguageModel; });

    test('renders when a snapshot exists and undoes on click', async () => {
        browser.storage.local.get.mockImplementation((k) =>
            Promise.resolve(k === 'chkTaboxAI' ? { chkTaboxAI: true } : { smartOrganizeUndo: { windowId: 5 } }));
        render(<SmartOrganizeUndoChip />);
        await waitFor(() => expect(screen.getByRole('button', { name: /undo smart organize/i })).toBeInTheDocument());
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /undo smart organize/i })); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'smartOrganizeUndo', windowId: 5 });
    });

    test('renders nothing when there is no snapshot', async () => {
        browser.storage.local.get.mockImplementation((k) =>
            Promise.resolve(k === 'chkTaboxAI' ? { chkTaboxAI: true } : {}));
        const { container } = render(<SmartOrganizeUndoChip />);
        await waitFor(() => expect(browser.storage.local.get).toHaveBeenCalled());
        expect(container.querySelector('.so-undo-chip')).toBeNull();
    });
});
