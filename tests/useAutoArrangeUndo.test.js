/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';
import { useAutoArrangeUndo } from '../app/ai/useAutoArrangeUndo';

let storageListener;

beforeEach(() => {
    jest.clearAllMocks();
    storageListener = undefined;
    browser.runtime.sendMessage = jest.fn().mockResolvedValue(null);
    jest.spyOn(browser.storage.onChanged, 'addListener').mockImplementation((fn) => { storageListener = fn; });
    jest.spyOn(browser.storage.onChanged, 'removeListener').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('derives the snapshot from a completed auto-arrange aiTaskState on mount', async () => {
    const undo = { task: 'auto-arrange', moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: [] };
    browser.runtime.sendMessage.mockResolvedValue({ type: 'auto-arrange', status: 'done', undo });
    const { result } = renderHook(() => useAutoArrangeUndo());
    await waitFor(() => expect(result.current.snapshot).toEqual(undo));
});

test('does not expose a snapshot for a still-running auto-arrange task', async () => {
    browser.runtime.sendMessage.mockResolvedValue({ type: 'auto-arrange', status: 'running', undo: null });
    const { result } = renderHook(() => useAutoArrangeUndo());
    await act(async () => {});
    expect(result.current.snapshot).toBeNull();
});

test('ignores aiTaskState for a different task type', async () => {
    browser.runtime.sendMessage.mockResolvedValue({ type: 'auto-rename', status: 'done', undo: { foo: 1 } });
    const { result } = renderHook(() => useAutoArrangeUndo());
    await act(async () => {});
    expect(result.current.snapshot).toBeNull();
});

test('tracks storage.onChanged updates to aiTaskState', async () => {
    const { result } = renderHook(() => useAutoArrangeUndo());
    await act(async () => {});
    const undo = { task: 'auto-arrange', moves: [], createdFolderUids: ['nf'] };
    await act(async () => {
        storageListener({ aiTaskState: { newValue: { type: 'auto-arrange', status: 'done', undo } } }, 'local');
    });
    expect(result.current.snapshot).toEqual(undo);
    // Cleared after the SW clears aiTaskState on undo.
    await act(async () => {
        storageListener({ aiTaskState: { newValue: null } }, 'local');
    });
    expect(result.current.snapshot).toBeNull();
});

test('undo() sends the aiUndo message', async () => {
    const { result } = renderHook(() => useAutoArrangeUndo());
    await act(async () => {});
    await act(async () => { await result.current.undo(); });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiUndo' });
});
