jest.mock('../app/ai/autoArrangeApply', () => ({
    AUTO_ARRANGE_UNDO_KEY: 'autoArrangeUndo',
    undoAutoArrange: jest.fn(),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';
import { useAutoArrangeUndo } from '../app/ai/useAutoArrangeUndo';
import { undoAutoArrange } from '../app/ai/autoArrangeApply';

beforeEach(() => {
    jest.clearAllMocks();
    browser.storage.local.get = jest.fn().mockResolvedValue({});
    jest.spyOn(browser.storage.onChanged, 'addListener');
    jest.spyOn(browser.storage.onChanged, 'removeListener');
});
afterEach(() => jest.restoreAllMocks());

test('loads the snapshot from storage on mount', async () => {
    const snap = { moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: [] };
    browser.storage.local.get.mockResolvedValue({ autoArrangeUndo: snap });
    const { result } = renderHook(() => useAutoArrangeUndo());
    await waitFor(() => expect(result.current.snapshot).toEqual(snap));
});

test('undo() calls undoAutoArrange with the snapshot', async () => {
    const snap = { moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: [] };
    browser.storage.local.get.mockResolvedValue({ autoArrangeUndo: snap });
    const { result } = renderHook(() => useAutoArrangeUndo());
    await waitFor(() => expect(result.current.snapshot).toEqual(snap));
    await act(async () => { await result.current.undo(); });
    expect(undoAutoArrange).toHaveBeenCalledWith(snap);
});
