import { renderHook, waitFor, act } from '@testing-library/react';
import { browser } from '../static/globals';
import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';

describe('useTaboxAIEnabled', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('reflects the stored chkTaboxAI flag', async () => {
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        const { result } = renderHook(() => useTaboxAIEnabled());
        await waitFor(() => expect(result.current).toBe(true));
    });

    test('defaults to false, reacts to storage changes, and cleans up on unmount', async () => {
        browser.storage.local.get.mockResolvedValue({});
        const addSpy = jest.spyOn(browser.storage.onChanged, 'addListener');
        const removeSpy = jest.spyOn(browser.storage.onChanged, 'removeListener');
        const { result, unmount } = renderHook(() => useTaboxAIEnabled());
        await waitFor(() => expect(result.current).toBe(false));
        const listener = addSpy.mock.calls[addSpy.mock.calls.length - 1][0];
        act(() => listener({ chkTaboxAI: { newValue: true } }));
        expect(result.current).toBe(true);
        unmount();
        expect(removeSpy).toHaveBeenCalledWith(listener);
    });
});
