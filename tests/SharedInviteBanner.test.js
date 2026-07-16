/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import SharedInviteBanner from '../app/SharedInviteBanner';
import { pendingInvitesState } from '../app/atoms/sharedFoldersState';

const INVITE = { folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'read' };

test('shows invite text and sends accept', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: { folderId: 'f1' } });
  const store = createStore();
  store.set(pendingInvitesState, [INVITE]);
  render(<Provider store={store}><SharedInviteBanner onAccepted={jest.fn()} /></Provider>);
  // Invite text is split across <strong>/plain-text nodes, so match on the
  // banner's overall text content rather than a single-node getByText.
  expect(screen.getByRole('status').textContent).toMatch(/o@x\.com wants to share the folder/);
  expect(screen.getByRole('status').textContent).toMatch(/"Team"/);
  fireEvent.click(screen.getByRole('button', { name: /accept/i }));
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedRespondInvite', folderId: 'f1', accept: true }));
});

test('calls onAccepted and removes the invite after a successful accept', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: { folderId: 'f1' } });
  const onAccepted = jest.fn();
  const store = createStore();
  store.set(pendingInvitesState, [INVITE]);
  render(<Provider store={store}><SharedInviteBanner onAccepted={onAccepted} /></Provider>);
  fireEvent.click(screen.getByRole('button', { name: /accept/i }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  await waitFor(() => expect(store.get(pendingInvitesState)).toEqual([]));
});

test('decline sends accept:false and does not call onAccepted', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: {} });
  const onAccepted = jest.fn();
  const store = createStore();
  store.set(pendingInvitesState, [INVITE]);
  render(<Provider store={store}><SharedInviteBanner onAccepted={onAccepted} /></Provider>);
  fireEvent.click(screen.getByRole('button', { name: /decline/i }));
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedRespondInvite', folderId: 'f1', accept: false }));
  expect(onAccepted).not.toHaveBeenCalled();
});

test('shows an error toast and keeps the invite when the response is not ok', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: false });
  const store = createStore();
  store.set(pendingInvitesState, [INVITE]);
  render(<Provider store={store}><SharedInviteBanner onAccepted={jest.fn()} /></Provider>);
  fireEvent.click(screen.getByRole('button', { name: /accept/i }));
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalled());
  expect(store.get(pendingInvitesState)).toEqual([INVITE]);
});

test('renders nothing when there are no pending invites', () => {
  const store = createStore();
  const { container } = render(<Provider store={store}><SharedInviteBanner onAccepted={jest.fn()} /></Provider>);
  expect(container).toBeEmptyDOMElement();
});
