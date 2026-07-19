/** @jest-environment jsdom */
// The pending link-join stash renders one persistent toast; Join sends
// sharedJoinLink; Dismiss clears the stash from storage.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import toast from 'react-hot-toast';
import { browser } from '../static/globals';
import SharedInviteToastController from '../app/SharedInviteToastController';
import { pendingInvitesState, pendingLinkJoinState } from '../app/atoms/sharedFoldersState';

const STASH = { token: 'tok', name: 'Team', ownerEmail: 'o@x.com', role: 'read' };

const linkJoinToastCall = () =>
  toast.custom.mock.calls.find(([, opts]) => opts?.id === 'shared-link-join');

const renderController = (store, onAccepted = jest.fn()) =>
  render(
    <Provider store={store}>
      <SharedInviteToastController onAccepted={onAccepted} />
    </Provider>
  );

const renderToast = (call, visible = true) => {
  const [renderFn, opts] = call;
  return render(renderFn({ id: opts.id, visible }));
};

beforeEach(() => {
  toast.custom.mockClear();
  toast.dismiss.mockClear();
  browser.runtime.sendMessage.mockReset();
  browser.storage.local.remove = jest.fn(async () => {});
});

test('shows a persistent join toast for a stashed link join', () => {
  const store = createStore();
  store.set(pendingInvitesState, []);
  store.set(pendingLinkJoinState, STASH);
  renderController(store);

  const call = linkJoinToastCall();
  expect(call).toBeTruthy();
  expect(call[1]).toEqual(expect.objectContaining({ duration: Infinity, position: 'bottom-right' }));

  renderToast(call);
  const status = screen.getByRole('status');
  expect(status.textContent).toContain('o@x.com');
  expect(status.textContent).toContain('"Team"');
});

test('Accept sends sharedJoinLink and calls onAccepted on success', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, status: 'joined', name: 'Team' });
  const onAccepted = jest.fn();
  const store = createStore();
  store.set(pendingLinkJoinState, STASH);
  renderController(store, onAccepted);

  renderToast(linkJoinToastCall());
  fireEvent.click(screen.getByRole('button', { name: /accept/i }));

  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedJoinLink', token: 'tok' }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalled());
});

test('Dismiss removes the stash from storage', async () => {
  const store = createStore();
  store.set(pendingLinkJoinState, STASH);
  renderController(store);

  renderToast(linkJoinToastCall());
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

  await waitFor(() => expect(browser.storage.local.remove).toHaveBeenCalledWith('shared_pending_link_join'));
});

test('clearing the stash dismisses the toast', () => {
  const store = createStore();
  store.set(pendingLinkJoinState, STASH);
  const { rerender } = renderController(store);
  expect(linkJoinToastCall()).toBeTruthy();

  store.set(pendingLinkJoinState, null);
  rerender(
    <Provider store={store}>
      <SharedInviteToastController onAccepted={jest.fn()} />
    </Provider>
  );
  expect(toast.dismiss).toHaveBeenCalledWith('shared-link-join');
});
