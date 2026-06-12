import { renderHook, waitFor, act } from '@testing-library/react';
import { browser } from '../static/globals';
import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';

describe('useTaboxAIEnabled', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
    });

    test('reflects the stored chkTaboxAI flag', async () => {
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        const { result } = renderHook(() => useTaboxAIEnabled());
        await waitFor(() => expect(result.current).toBe(true));
    });

    test('defaults to false and reacts to storage changes', async () => {
        browser.storage.local.get.mockResolvedValue({});
        let listener;
        const originalAdd = browser.storage.onChanged.addListener;
        browser.storage.onChanged.addListener = jest.fn((cb) => { listener = cb; });
        const { result } = renderHook(() => useTaboxAIEnabled());
        await waitFor(() => expect(result.current).toBe(false));
        act(() => listener({ chkTaboxAI: { newValue: true } }));
        expect(result.current).toBe(true);
        browser.storage.onChanged.addListener = originalAdd;
    });
});
