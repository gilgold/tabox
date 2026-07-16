/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import ShareFolderModal from '../app/ShareFolderModal';
import { shareFolderModalState } from '../app/atoms/sharedFoldersState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

jest.mock('../app/toastHelpers', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }));

const PRO = { entitled: true, refreshedAt: new Date().toISOString() };
const FOLDER = { uid: 'f1', name: 'Team', color: '#f00' };

const renderModal = (folder = FOLDER, entitlement = PRO) => {
  const store = createStore();
  store.set(shareFolderModalState, folder);
  store.set(premiumEntitlementState, entitlement);
  render(<Provider store={store}><ShareFolderModal /></Provider>);
  return store;
};

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as
// static jest.fn()s (no real backing store, no `.clear()`), so we install a
// tiny in-memory store here rather than relying on `browser.storage.local.clear()`.
function installStorageMock() {
  const store = {};
  browser.storage.local.get = jest.fn(async (keys) => {
    if (keys === undefined || keys === null) return { ...store };
    const names = Array.isArray(keys) ? keys : [keys];
    return names.reduce((acc, k) => ({ ...acc, [k]: store[k] }), {});
  });
  browser.storage.local.set = jest.fn(async (obj) => {
    Object.assign(store, obj);
  });
}

beforeEach(() => {
  browser.runtime.sendMessage.mockReset();
  installStorageMock();
});

test('non-Pro sees the upgrade prompt instead of the share form', async () => {
  renderModal(FOLDER, { entitled: false });
  expect(screen.getByText(/Tabox Pro/i)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/email/i)).not.toBeInTheDocument();
  // flush the un-awaited contacts-suggestions effect so it doesn't settle after the test ends
  await act(async () => {});
});

test('first share sends sharedCreateShare with the folder collections and chosen role', async () => {
  await browser.storage.local.set({
    collections_index: { c1: { uid: 'c1', parentId: 'f1' } },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [] },
  });
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: { members: [{ email: 'g@x.com', role: 'write', status: 'invited' }] } });
  renderModal();
  // flush the un-awaited contacts-suggestions effect before interacting
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'g@x.com' } });
  fireEvent.change(screen.getByLabelText(/permission/i), { target: { value: 'write' } });
  fireEvent.click(screen.getByRole('button', { name: /share/i }));
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'sharedCreateShare',
    folder: expect.objectContaining({ uid: 'f1' }),
    collections: [expect.objectContaining({ uid: 'c1' })],
    invites: [{ email: 'g@x.com', role: 'write' }],
  })));
});

test('owner sees per-member status (Pending/Active/Declined), can change roles, revoke, and re-invite', async () => {
  const MEMBERS = [
    { email: 'a@x.com', role: 'write', status: 'active' },
    { email: 'p@x.com', role: 'read', status: 'invited' },
    { email: 'd@x.com', role: 'read', status: 'declined' },
  ];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    return { ok: true, data: { members: MEMBERS } };
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  // on-open refresh hits the server
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedGetMembers', folderId: 'f1' }));
  expect(await screen.findByText('Active')).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
  expect(screen.getByText('Declined')).toBeInTheDocument();
  // owner changes a member's permission level
  fireEvent.change(screen.getByLabelText('Permission for a@x.com'), { target: { value: 'read' } });
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedUpdateMemberRole', folderId: 'f1', email: 'a@x.com', role: 'read' }));
  // busy resets once the request settles, re-enabling the row controls for the next action
  const reinviteButton = await screen.findByRole('button', { name: /invite again/i });
  await waitFor(() => expect(reinviteButton).not.toBeDisabled());
  // declined member can be re-invited with their previous role
  fireEvent.click(reinviteButton);
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedInvite', folderId: 'f1', email: 'd@x.com', role: 'read' }));
  const revokeButtons = await screen.findAllByRole('button', { name: /revoke/i });
  await waitFor(() => expect(revokeButtons[0]).not.toBeDisabled());
  // revoke an active member
  fireEvent.click(revokeButtons[0]);
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedRemoveMember', folderId: 'f1', email: 'a@x.com' }));
});

test('double-clicking Revoke fires exactly one sharedRemoveMember request while busy', async () => {
  const MEMBERS = [{ email: 'a@x.com', role: 'write', status: 'active' }];
  let resolveRemove;
  browser.runtime.sendMessage.mockImplementation((msg) => {
    if (msg.type === 'sharedGetMembers') return Promise.resolve({ ok: true, data: { members: MEMBERS, role: 'owner' } });
    if (msg.type === 'sharedRemoveMember') return new Promise((resolve) => { resolveRemove = resolve; });
    return Promise.resolve({ ok: true, data: { members: MEMBERS } });
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedGetMembers', folderId: 'f1' }));
  await screen.findByText('Active');

  const revokeButton = screen.getByRole('button', { name: /revoke/i });
  fireEvent.click(revokeButton);
  // busy is now true (the sharedRemoveMember promise above is still pending) — the button must be
  // disabled so a second, accidental click doesn't fire a duplicate request
  expect(revokeButton).toBeDisabled();
  fireEvent.click(revokeButton);

  const removeCalls = browser.runtime.sendMessage.mock.calls.filter(([m]) => m.type === 'sharedRemoveMember');
  expect(removeCalls).toHaveLength(1);

  await act(async () => { resolveRemove({ ok: true, data: {} }); });
  await waitFor(() => expect(screen.queryByText('a@x.com')).not.toBeInTheDocument());
});

test('an orphaned collections_index entry (no matching record) is skipped, not crashed on, when gathering the first share', async () => {
  await browser.storage.local.set({
    collections_index: {
      c1: { uid: 'c1', parentId: 'f1' },
      c2: { uid: 'c2', parentId: 'f1' }, // orphaned: no collection_c2 record below
    },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [] },
  });
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: { members: [{ email: 'g@x.com', role: 'read', status: 'invited' }] } });
  renderModal();
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'g@x.com' } });
  fireEvent.click(screen.getByRole('button', { name: /share/i }));
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'sharedCreateShare' })));

  const [createShareCall] = browser.runtime.sendMessage.mock.calls.find(([m]) => m.type === 'sharedCreateShare');
  expect(createShareCall.collections).toEqual([expect.objectContaining({ uid: 'c1' })]);
});

test('a non-owner (role "write") shared folder does not render the member-management section', async () => {
  const MEMBERS = [{ email: 'a@x.com', role: 'write', status: 'active' }];
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'write', members: MEMBERS } });
  await act(async () => {});
  expect(screen.queryByText('People with access')).not.toBeInTheDocument();
  expect(screen.queryByText('a@x.com')).not.toBeInTheDocument();
  // the owner-only refresh must not be triggered for non-owners either
  expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sharedGetMembers' }));
});
