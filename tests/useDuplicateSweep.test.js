import { renderHook, act, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';
import { useDuplicateSweep } from '../app/ai/useDuplicateSweep';

jest.mock('../static/globals', () => {
  const listeners = [];
  const store = {};
  return { browser: {
    storage: { local: {
      get: jest.fn(async (k) => ({ [k]: store[k] })),
      remove: jest.fn(async () => {}),
      __emit: (changes) => listeners.forEach((l) => l(changes, 'local')),
    }, onChanged: { addListener: (l) => listeners.push(l), removeListener: () => {} } },
    runtime: { sendMessage: jest.fn(async () => ({ ok: true })) },
  } };
});

test('reflects storage state and sends apply/undo/dismiss messages', async () => {
  const { result } = renderHook(() => useDuplicateSweep());
  act(() => { browser.storage.local.__emit({ duplicateSweep: { newValue: { groups: [{ id: 'g1', status: 'pending' }], history: [] } } }); });
  await waitFor(() => expect(result.current.state.groups).toHaveLength(1));

  await act(async () => { await result.current.apply({ groupId: 'g1', action: 'keep-one', keeperUid: 'D' }); });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'duplicateSweepApply', groupId: 'g1', action: 'keep-one', keeperUid: 'D', applyToAll: false });

  await act(async () => { await result.current.undo(); });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'duplicateSweepUndo' });

  await act(async () => { await result.current.dismiss(); });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'duplicateSweepDismiss' });
});
