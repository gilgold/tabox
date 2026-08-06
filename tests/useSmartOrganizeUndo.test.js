// tests/useSmartOrganizeUndo.test.js
import { renderHook, waitFor, act } from '@testing-library/react';
import { browser } from '../static/globals';
import { useSmartOrganizeUndo } from '../app/ai/useSmartOrganizeUndo';

describe('useSmartOrganizeUndo', () => {
    beforeEach(() => {
        browser.storage.local.get = jest.fn().mockResolvedValue({});
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true });
        jest.spyOn(browser.storage.onChanged, 'addListener');
        jest.spyOn(browser.storage.onChanged, 'removeListener');
    });
    afterEach(() => jest.restoreAllMocks());

    test('exposes the stored snapshot and reacts to storage changes', async () => {
        browser.storage.local.get.mockResolvedValue({ smartOrganizeUndo: { windowId: 5 } });
        const { result } = renderHook(() => useSmartOrganizeUndo());
        await waitFor(() => expect(result.current.snapshot).toEqual({ windowId: 5 }));

        const listener = browser.storage.onChanged.addListener.mock.calls[0][0];
        act(() => listener({ smartOrganizeUndo: { newValue: undefined } }));
        expect(result.current.snapshot).toBeNull();
    });

    test('undo() sends the smartOrganizeUndo message for the snapshot window', async () => {
        browser.storage.local.get.mockResolvedValue({ smartOrganizeUndo: { windowId: 5 } });
        const { result } = renderHook(() => useSmartOrganizeUndo());
        await waitFor(() => expect(result.current.snapshot).not.toBeNull());
        await act(async () => { await result.current.undo(); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'smartOrganizeUndo', windowId: 5 });
    });

    test('dismiss() clears the storage key without undoing', async () => {
        browser.storage.local.remove = jest.fn().mockResolvedValue();
        browser.storage.local.get.mockResolvedValue({ smartOrganizeUndo: { windowId: 5 } });
        const { result } = renderHook(() => useSmartOrganizeUndo());
        await waitFor(() => expect(result.current.snapshot).not.toBeNull());
        await act(async () => { await result.current.dismiss(); });
        expect(browser.storage.local.remove).toHaveBeenCalledWith('smartOrganizeUndo');
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
});
