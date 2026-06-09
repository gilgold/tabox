/** @jest-environment jsdom */
jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(), set: jest.fn() } } },
}));
jest.mock('../app/utils/orphanRecovery', () => ({
    detectRecoverableCollections: jest.fn(),
    recoverOrphanedCollections: jest.fn(),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';
import { detectRecoverableCollections, recoverOrphanedCollections } from '../app/utils/orphanRecovery';
import useOrphanRecovery from '../app/useOrphanRecovery';

beforeEach(() => {
    jest.clearAllMocks();
    browser.storage.local.get.mockResolvedValue({});       // no dismiss flag
    browser.storage.local.set.mockResolvedValue(undefined);
});

test('does not detect until ready is true', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a' }]);
    const { result } = renderHook(() => useOrphanRecovery(false));
    expect(detectRecoverableCollections).not.toHaveBeenCalled();
    expect(result.current.showModal).toBe(false);
});

test('shows modal when orphans exist and not dismissed', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a', name: 'A' }]);
    const { result } = renderHook(() => useOrphanRecovery(true));
    await waitFor(() => expect(result.current.orphanCount).toBe(1));
    expect(result.current.showModal).toBe(true);
    expect(result.current.showEntry).toBe(true);
});

test('dismiss() persists the flag and hides the modal but keeps the entry', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a', name: 'A' }]);
    const { result } = renderHook(() => useOrphanRecovery(true));
    await waitFor(() => expect(result.current.showModal).toBe(true));

    await act(async () => { await result.current.dismiss(); });

    expect(browser.storage.local.set).toHaveBeenCalledWith({ orphanRecoveryModalDismissed: true });
    expect(result.current.showModal).toBe(false);
    expect(result.current.showEntry).toBe(true);
});

test('recover() restores, re-detects, and fires onRecovered', async () => {
    detectRecoverableCollections
        .mockResolvedValueOnce([{ uid: 'a', name: 'A' }])  // initial
        .mockResolvedValueOnce([]);                        // after recovery
    recoverOrphanedCollections.mockResolvedValue({ success: true, recovered: 1, uids: ['a'] });
    const onRecovered = jest.fn();

    const { result } = renderHook(() => useOrphanRecovery(true, { onRecovered }));
    await waitFor(() => expect(result.current.orphanCount).toBe(1));

    await act(async () => { await result.current.recover(); });

    expect(recoverOrphanedCollections).toHaveBeenCalledWith(['a']);
    expect(onRecovered).toHaveBeenCalledWith(1);
    await waitFor(() => expect(result.current.orphanCount).toBe(0));
});

test('busy is true during recovery and a concurrent recover() is ignored', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a', name: 'A' }]);
    let resolveRecover;
    recoverOrphanedCollections.mockReturnValue(new Promise((res) => { resolveRecover = res; }));

    const { result } = renderHook(() => useOrphanRecovery(true));
    await waitFor(() => expect(result.current.orphanCount).toBe(1));

    let firstCall;
    act(() => { firstCall = result.current.recover(); });
    await waitFor(() => expect(result.current.busy).toBe(true));

    // A second call while busy is rejected without invoking recovery again.
    const second = await result.current.recover();
    expect(second).toMatchObject({ success: false, error: 'busy' });
    expect(recoverOrphanedCollections).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRecover({ success: true, recovered: 1, uids: ['a'] }); await firstCall; });
    expect(result.current.busy).toBe(false);
});
