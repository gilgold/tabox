/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import toast from 'react-hot-toast';
import { browser } from '../static/globals';
import SharedInviteToastController from '../app/SharedInviteToastController';
import { pendingInvitesState, sharedActionConfirmState } from '../app/atoms/sharedFoldersState';

// react-hot-toast is mocked globally in jest.setup.js (toast.custom /
// toast.dismiss are jest.fn()), so the controller's toast.custom calls are
// inspected directly and their render callbacks rendered by hand.

// NOTE: session-dismissals live in module state inside the controller, so
// each test uses a unique folderId to stay isolated.
const makeInvite = (folderId, overrides = {}) => ({
  folderId,
  folderName: 'Team',
  ownerEmail: 'owner@example.com',
  role: 'read',
  ...overrides,
});

const inviteToastCalls = () =>
  toast.custom.mock.calls.filter(([, opts]) => opts?.id?.startsWith('shared-invite-'));

const renderController = (store, onAccepted = jest.fn()) =>
  render(
    <Provider store={store}>
      <SharedInviteToastController onAccepted={onAccepted} />
    </Provider>
  );

const renderInviteToast = (call, visible = true) => {
  const [renderFn, opts] = call;
  return render(renderFn({ id: opts.id, visible }));
};

beforeEach(() => {
  toast.custom.mockClear();
  toast.dismiss.mockClear();
  browser.runtime.sendMessage.mockReset();
});

test('shows a persistent bottom-right toast with the invite info', () => {
  const store = createStore();
  store.set(pendingInvitesState, [makeInvite('f-content')]);
  renderController(store);

  const calls = inviteToastCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual(
    expect.objectContaining({
      id: 'shared-invite-f-content',
      duration: Infinity,
      position: 'bottom-right',
    })
  );

  renderInviteToast(calls[0]);
  const status = screen.getByRole('status');
  expect(status.textContent).toMatch(/owner@example\.com invited you to/);
  expect(status.textContent).toMatch(/"Team"/);
  expect(status.textContent).toMatch(/view only/);
  expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
});

test('omits the view-only hint for write invites', () => {
  const store = createStore();
  store.set(pendingInvitesState, [makeInvite('f-write', { role: 'write' })]);
  renderController(store);

  renderInviteToast(inviteToastCalls()[0]);
  expect(screen.getByRole('status').textContent).not.toMatch(/view only/);
});

test('Accept sends the runtime message, calls onAccepted and dismisses the toast', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: true });
  const onAccepted = jest.fn();
  const store = createStore();
  store.set(pendingInvitesState, [makeInvite('f-accept')]);
  renderController(store, onAccepted);

  renderInviteToast(inviteToastCalls()[0]);
  fireEvent.click(screen.getByRole('button', { name: /accept/i }));

  await waitFor(() =>
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sharedRespondInvite',
      folderId: 'f-accept',
      accept: true,
    })
  );
  await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  expect(toast.dismiss).toHaveBeenCalledWith('shared-invite-f-accept');
});

test('failed Accept keeps the toast and re-enables the buttons', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: false });
  const onAccepted = jest.fn();
  const store = createStore();
  store.set(pendingInvitesState, [makeInvite('f-fail')]);
  renderController(store, onAccepted);

  renderInviteToast(inviteToastCalls()[0]);
  fireEvent.click(screen.getByRole('button', { name: /accept/i }));

  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalled());
  expect(onAccepted).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalledWith('shared-invite-f-fail');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /accept/i })).not.toBeDisabled()
  );
});

test('Decline opens the confirm modal state and does not dismiss the toast', () => {
  const invite = makeInvite('f-decline');
  const store = createStore();
  store.set(pendingInvitesState, [invite]);
  renderController(store);

  renderInviteToast(inviteToastCalls()[0]);
  fireEvent.click(screen.getByRole('button', { name: /decline/i }));

  expect(store.get(sharedActionConfirmState)).toEqual({ kind: 'decline-invite', invite });
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
});

test('dismisses the toast when the invite leaves pendingInvitesState', async () => {
  const store = createStore();
  store.set(pendingInvitesState, [makeInvite('f-gone')]);
  renderController(store);
  expect(inviteToastCalls()).toHaveLength(1);

  await act(async () => {
    store.set(pendingInvitesState, []);
  });

  await waitFor(() =>
    expect(toast.dismiss).toHaveBeenCalledWith('shared-invite-f-gone')
  );
});

test('close button dismisses session-locally and the toast does not re-show', async () => {
  const invite = makeInvite('f-close');
  const store = createStore();
  store.set(pendingInvitesState, [invite]);
  renderController(store);

  renderInviteToast(inviteToastCalls()[0]);
  fireEvent.click(screen.getByRole('button', { name: /dismiss invite/i }));
  expect(toast.dismiss).toHaveBeenCalledWith('shared-invite-f-close');
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();

  // Cycle the invite out and back in — the session-local dismissal must
  // prevent a second toast while the view stays open.
  await act(async () => {
    store.set(pendingInvitesState, []);
  });
  await act(async () => {
    store.set(pendingInvitesState, [invite]);
  });
  expect(inviteToastCalls()).toHaveLength(1);
});
