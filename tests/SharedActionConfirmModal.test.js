/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import SharedActionConfirmModal from '../app/SharedActionConfirmModal';
import { sharedActionConfirmState } from '../app/atoms/sharedFoldersState';

const FOLDER = { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'owner', members: [] } };

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders nothing when closed', () => {
  const store = createStore();
  const { container } = render(<Provider store={store}><SharedActionConfirmModal onConfirmed={jest.fn()} /></Provider>);
  expect(container).toBeEmptyDOMElement();
});

test('renders unshare-specific copy', () => {
  const store = createStore();
  store.set(sharedActionConfirmState, { kind: 'unshare', folder: FOLDER });
  render(<Provider store={store}><SharedActionConfirmModal onConfirmed={jest.fn()} /></Provider>);

  expect(screen.getByText(/Stop sharing "Team"\? All members will lose access\. Your local copy is kept\./)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop Sharing' })).toBeInTheDocument();
});

test('renders leave-specific copy', () => {
  const store = createStore();
  store.set(sharedActionConfirmState, { kind: 'leave', folder: FOLDER });
  render(<Provider store={store}><SharedActionConfirmModal onConfirmed={jest.fn()} /></Provider>);

  expect(screen.getByText(/Leave "Team"\? You'll keep a local copy but stop receiving updates\./)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
});

test('Confirm sends sharedUnshareFolder, calls onConfirmed, and closes the modal', async () => {
  browser.runtime.sendMessage.mockResolvedValue(undefined);
  const onConfirmed = jest.fn().mockResolvedValue(undefined);
  const store = createStore();
  store.set(sharedActionConfirmState, { kind: 'unshare', folder: FOLDER });
  render(<Provider store={store}><SharedActionConfirmModal onConfirmed={onConfirmed} /></Provider>);

  fireEvent.click(screen.getByRole('button', { name: 'Stop Sharing' }));

  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedUnshareFolder', folderId: 'f1' }));
  await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  await waitFor(() => expect(store.get(sharedActionConfirmState)).toBeNull());
});

test('Confirm sends sharedLeaveFolder for the leave kind', async () => {
  browser.runtime.sendMessage.mockResolvedValue(undefined);
  const onConfirmed = jest.fn().mockResolvedValue(undefined);
  const store = createStore();
  store.set(sharedActionConfirmState, { kind: 'leave', folder: FOLDER });
  render(<Provider store={store}><SharedActionConfirmModal onConfirmed={onConfirmed} /></Provider>);

  fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedLeaveFolder', folderId: 'f1' }));
  await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
});

test('Cancel does not send any message and closes the modal', () => {
  const onConfirmed = jest.fn();
  const store = createStore();
  store.set(sharedActionConfirmState, { kind: 'unshare', folder: FOLDER });
  render(<Provider store={store}><SharedActionConfirmModal onConfirmed={onConfirmed} /></Provider>);

  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(store.get(sharedActionConfirmState)).toBeNull();
});

test('a failed send keeps the modal open (does not clear the atom)', async () => {
  browser.runtime.sendMessage.mockRejectedValue(new Error('network'));
  const store = createStore();
  store.set(sharedActionConfirmState, { kind: 'unshare', folder: FOLDER });
  render(<Provider store={store}><SharedActionConfirmModal onConfirmed={jest.fn()} /></Provider>);

  fireEvent.click(screen.getByRole('button', { name: 'Stop Sharing' }));

  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalled());
  expect(store.get(sharedActionConfirmState)).toEqual({ kind: 'unshare', folder: FOLDER });
});
