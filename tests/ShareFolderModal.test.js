/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import ShareFolderModal from '../app/ShareFolderModal';
import { shareFolderModalState } from '../app/atoms/sharedFoldersState';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { showSuccessToast, showErrorToast } from '../app/toastHelpers';

jest.mock('../app/toastHelpers', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));
import { getAIAvailability } from '../app/ai/aiClient';

const PRO = { entitled: true, refreshedAt: new Date().toISOString() };
const FOLDER = { uid: 'f1', name: 'Team', color: '#f00' };
const shareFolderModalCss = fs.readFileSync(path.join(__dirname, '../app/ShareFolderModal.css'), 'utf8');

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
  showSuccessToast.mockClear();
  showErrorToast.mockClear();
  installStorageMock();
  getAIAvailability.mockResolvedValue('available');
});

test('batch toolbar stays on one row at popup width and only wraps on very narrow screens', () => {
  const toolbarRule = shareFolderModalCss.match(/\.share-batch-toolbar\s*{[^}]+}/)?.[0] || '';
  const accessSelectRule = shareFolderModalCss.match(/\.share-batch-actions select\s*{[^}]+}/)?.[0] || '';
  const narrowRule = shareFolderModalCss.match(/@media \(max-width: 440px\)\s*{[\s\S]+?\.share-batch-toolbar\s*{[^}]+}/)?.[0] || '';

  expect(toolbarRule).toContain('flex-wrap: nowrap');
  expect(accessSelectRule).toContain('width: 92px');
  expect(narrowRule).toContain('flex-wrap: wrap');
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

test('changing a member permission shows row progress and a success toast', async () => {
  const MEMBERS = [{ email: 'a@x.com', role: 'write', status: 'active' }];
  let resolveRoleUpdate;
  browser.runtime.sendMessage.mockImplementation((msg) => {
    if (msg.type === 'sharedGetMembers') return Promise.resolve({ ok: true, data: { members: MEMBERS, role: 'owner' } });
    if (msg.type === 'sharedUpdateMemberRole') return new Promise((resolve) => { resolveRoleUpdate = resolve; });
    return Promise.resolve({ ok: true, data: { members: MEMBERS } });
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  const permission = await screen.findByLabelText('Permission for a@x.com');

  fireEvent.change(permission, { target: { value: 'read' } });

  expect(screen.getByRole('status', { name: /updating permission for a@x.com/i })).toHaveTextContent('Updating…');
  expect(permission).toBeDisabled();
  expect(showSuccessToast).not.toHaveBeenCalled();

  await act(async () => { resolveRoleUpdate({ ok: true, data: {} }); });

  await waitFor(() => expect(screen.queryByRole('status', { name: /updating permission/i })).not.toBeInTheDocument());
  expect(permission).toHaveValue('read');
  expect(showSuccessToast).toHaveBeenCalledWith('Permission updated: a@x.com can now view this folder.');
});

test('failed member permission change removes progress and shows an error toast', async () => {
  const MEMBERS = [{ email: 'a@x.com', role: 'read', status: 'active' }];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    if (msg.type === 'sharedUpdateMemberRole') return { ok: false, error: 'server_error' };
    return { ok: true, data: { members: MEMBERS } };
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  const permission = await screen.findByLabelText('Permission for a@x.com');

  fireEvent.change(permission, { target: { value: 'write' } });

  await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith("Couldn’t update permission for a@x.com. Please try again."));
  expect(screen.queryByRole('status', { name: /updating permission/i })).not.toBeInTheDocument();
  expect(permission).toHaveValue('read');
  expect(showSuccessToast).not.toHaveBeenCalled();
});

test('owner can select people individually or select all filtered results, then select none', async () => {
  const MEMBERS = [
    { email: 'alice@example.com', role: 'write', status: 'active' },
    { email: 'bob@example.com', role: 'read', status: 'invited' },
    { email: 'carol@team.test', role: 'read', status: 'active' },
    { email: 'declined@example.com', role: 'read', status: 'declined' },
  ];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    return { ok: true, data: { members: MEMBERS } };
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  const search = await screen.findByRole('searchbox', { name: /search people with access/i });

  fireEvent.click(screen.getByRole('checkbox', { name: 'Select alice@example.com' }));
  expect(screen.getByText('1 selected')).toBeInTheDocument();

  fireEvent.change(search, { target: { value: 'example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  expect(screen.getByRole('checkbox', { name: 'Select alice@example.com' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select bob@example.com' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select declined@example.com' })).toBeDisabled();
  expect(screen.getByText('2 selected')).toBeInTheDocument();

  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByRole('checkbox', { name: 'Select carol@team.test' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
  expect(screen.getByRole('checkbox', { name: 'Select alice@example.com' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select bob@example.com' })).not.toBeChecked();
  expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
});

test('batch permission update processes selected people sequentially with progress and a toast', async () => {
  const MEMBERS = [
    { email: 'a@x.com', role: 'write', status: 'active' },
    { email: 'b@x.com', role: 'write', status: 'active' },
  ];
  let resolveFirstUpdate;
  let updateCount = 0;
  browser.runtime.sendMessage.mockImplementation((msg) => {
    if (msg.type === 'sharedGetMembers') return Promise.resolve({ ok: true, data: { members: MEMBERS, role: 'owner' } });
    if (msg.type === 'sharedUpdateMemberRole') {
      updateCount += 1;
      if (updateCount === 1) return new Promise((resolve) => { resolveFirstUpdate = resolve; });
      return Promise.resolve({ ok: true, data: {} });
    }
    return Promise.resolve({ ok: true, data: { members: MEMBERS } });
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  await screen.findByRole('checkbox', { name: 'Select a@x.com' });
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  fireEvent.change(screen.getByLabelText('Access for selected people'), { target: { value: 'read' } });

  fireEvent.click(screen.getByRole('button', { name: 'Update access' }));

  expect(screen.getByRole('status', { name: /updating access for 2 people/i })).toHaveTextContent('Updating 1 of 2…');
  expect(browser.runtime.sendMessage.mock.calls.filter(([msg]) => msg.type === 'sharedUpdateMemberRole')).toHaveLength(1);

  await act(async () => { resolveFirstUpdate({ ok: true, data: {} }); });

  await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('Updated access for 2 people — they can now view this folder.'));
  const roleCalls = browser.runtime.sendMessage.mock.calls
    .filter(([msg]) => msg.type === 'sharedUpdateMemberRole')
    .map(([msg]) => msg);
  expect(roleCalls).toEqual([
    { type: 'sharedUpdateMemberRole', folderId: 'f1', email: 'a@x.com', role: 'read' },
    { type: 'sharedUpdateMemberRole', folderId: 'f1', email: 'b@x.com', role: 'read' },
  ]);
  expect(screen.getByLabelText('Permission for a@x.com')).toHaveValue('read');
  expect(screen.getByLabelText('Permission for b@x.com')).toHaveValue('read');
  expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
});

test('batch permission update keeps failed people selected for retry', async () => {
  const MEMBERS = [
    { email: 'a@x.com', role: 'write', status: 'active' },
    { email: 'b@x.com', role: 'write', status: 'active' },
  ];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    if (msg.type === 'sharedUpdateMemberRole') return { ok: msg.email === 'a@x.com', data: {} };
    return { ok: true, data: {} };
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  await screen.findByRole('checkbox', { name: 'Select a@x.com' });
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

  fireEvent.click(screen.getByRole('button', { name: 'Update access' }));

  await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Updated 1 of 2 people. Couldn’t update 1.'));
  expect(screen.getByLabelText('Permission for a@x.com')).toHaveValue('read');
  expect(screen.getByLabelText('Permission for b@x.com')).toHaveValue('write');
  expect(screen.getByRole('checkbox', { name: 'Select a@x.com' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select b@x.com' })).toBeChecked();
  expect(screen.getByText('1 selected')).toBeInTheDocument();
});

test('batch revoke removes every selected person and confirms the result', async () => {
  const MEMBERS = [
    { email: 'a@x.com', role: 'write', status: 'active' },
    { email: 'b@x.com', role: 'read', status: 'invited' },
    { email: 'c@x.com', role: 'read', status: 'active' },
  ];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    return { ok: true, data: {} };
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  await screen.findByRole('checkbox', { name: 'Select a@x.com' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select a@x.com' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select c@x.com' }));

  fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));

  await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('Revoked access for 2 people.'));
  const revokeCalls = browser.runtime.sendMessage.mock.calls
    .filter(([msg]) => msg.type === 'sharedRemoveMember')
    .map(([msg]) => msg);
  expect(revokeCalls).toEqual([
    { type: 'sharedRemoveMember', folderId: 'f1', email: 'a@x.com' },
    { type: 'sharedRemoveMember', folderId: 'f1', email: 'c@x.com' },
  ]);
  expect(screen.queryByText('a@x.com')).not.toBeInTheDocument();
  expect(screen.getByText('b@x.com')).toBeInTheDocument();
  expect(screen.queryByText('c@x.com')).not.toBeInTheDocument();
});

test('owner can search the people-with-access list by email, case-insensitively', async () => {
  const MEMBERS = [
    { email: 'Alice@Example.com', role: 'write', status: 'active' },
    { email: 'bob@example.com', role: 'read', status: 'invited' },
    { email: 'carol@team.test', role: 'read', status: 'active' },
  ];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    return { ok: true, data: { members: MEMBERS } };
  });

  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  expect(await screen.findByText('3 people')).toBeInTheDocument();

  fireEvent.change(screen.getByRole('searchbox', { name: /search people with access/i }), {
    target: { value: 'EXAMPLE' },
  });

  expect(screen.getByText('Alice@Example.com')).toBeInTheDocument();
  expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  expect(screen.queryByText('carol@team.test')).not.toBeInTheDocument();
  expect(screen.getByText('2 of 3 people')).toBeInTheDocument();
});

test('member search shows a useful empty result and can be cleared', async () => {
  const MEMBERS = [
    { email: 'alice@example.com', role: 'write', status: 'active' },
    { email: 'bob@example.com', role: 'read', status: 'invited' },
  ];
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    if (msg.type === 'sharedGetMembers') return { ok: true, data: { members: MEMBERS, role: 'owner' } };
    return { ok: true, data: { members: MEMBERS } };
  });

  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  const search = await screen.findByRole('searchbox', { name: /search people with access/i });
  fireEvent.change(search, { target: { value: 'nobody' } });

  expect(screen.getByText(/no people match “nobody”/i)).toBeInTheDocument();
  expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /clear people search/i }));
  expect(search).toHaveValue('');
  expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  expect(screen.getByText('bob@example.com')).toBeInTheDocument();
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

test('non-Pro upgrade prompt shows no warning when Tabox AI works', async () => {
  renderModal(FOLDER, { entitled: false });
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Share-with-link section
// ---------------------------------------------------------------------------

// Routes sendMessage by message type so link calls and invite/member calls can
// coexist in one test.
const mockMessagesByType = (byType) => {
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    const handler = byType[msg.type];
    return handler ? handler(msg) : { ok: true, data: {} };
  });
};

const SHARED_OWNED = { ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: [] } };
const LINK = { token: 't1', role: 'read', createdAt: 1, url: 'https://api/join/t1' };

test('owner of a shared folder sees the link section and can create a link', async () => {
  mockMessagesByType({
    sharedGetMembers: () => ({ ok: true, data: { members: [] } }),
    sharedGetFolderLink: () => ({ ok: true, data: { link: null } }),
    sharedCreateFolderLink: () => ({ ok: true, data: { token: 't1', role: 'read', url: 'https://api/join/t1' } }),
  });
  renderModal(SHARED_OWNED);
  await act(async () => {});
  expect(screen.getByText('Share with link')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /create link/i }));
  await waitFor(() => expect(screen.getByDisplayValue('https://api/join/t1')).toBeInTheDocument());
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedCreateFolderLink', folderId: 'f1', role: 'read' });
});

test('copies the link url to the clipboard', async () => {
  mockMessagesByType({
    sharedGetMembers: () => ({ ok: true, data: { members: [] } }),
    sharedGetFolderLink: () => ({ ok: true, data: { link: LINK } }),
  });
  const writeText = jest.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderModal(SHARED_OWNED);
  await act(async () => {});
  fireEvent.click(await screen.findByRole('button', { name: /^copy$/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://api/join/t1'));
});

test('changing the link role re-sends sharedCreateFolderLink with the new role', async () => {
  mockMessagesByType({
    sharedGetMembers: () => ({ ok: true, data: { members: [] } }),
    sharedGetFolderLink: () => ({ ok: true, data: { link: LINK } }),
    sharedCreateFolderLink: (msg) => ({ ok: true, data: { token: 't1', role: msg.role, url: 'https://api/join/t1' } }),
  });
  renderModal(SHARED_OWNED);
  await act(async () => {});
  fireEvent.change(await screen.findByLabelText(/permission for people joining/i), { target: { value: 'write' } });
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedCreateFolderLink', folderId: 'f1', role: 'write' }));
});

test('a link role change re-grades link-joined members in the list and says so', async () => {
  const MEMBERS = [
    { email: 'via-link@x.com', role: 'write', status: 'active' },
    { email: 'invited@x.com', role: 'write', status: 'active' },
  ];
  mockMessagesByType({
    sharedGetMembers: () => ({ ok: true, data: { members: MEMBERS } }),
    sharedGetFolderLink: () => ({ ok: true, data: { link: { ...LINK, role: 'write' } } }),
    sharedCreateFolderLink: (msg) => ({
      ok: true,
      data: {
        token: 't1', role: msg.role, url: 'https://api/join/t1',
        updatedMembers: [{ email: 'via-link@x.com', role: 'read' }],
      },
    }),
  });
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'owner', members: MEMBERS } });
  await act(async () => {});
  fireEvent.change(await screen.findByLabelText(/permission for people joining/i), { target: { value: 'read' } });
  await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith(
    expect.stringMatching(/access changed for 1 person who joined via this link/i)
  ));
  expect(screen.getByLabelText('Permission for via-link@x.com')).toHaveValue('read');
  expect(screen.getByLabelText('Permission for invited@x.com')).toHaveValue('write');
});

test('"New link" rotates (sends rotate: true) and shows the fresh url', async () => {
  mockMessagesByType({
    sharedGetMembers: () => ({ ok: true, data: { members: [] } }),
    sharedGetFolderLink: () => ({ ok: true, data: { link: LINK } }),
    sharedCreateFolderLink: () => ({ ok: true, data: { token: 't2', role: 'read', url: 'https://api/join/t2' } }),
  });
  renderModal(SHARED_OWNED);
  await act(async () => {});
  fireEvent.click(await screen.findByRole('button', { name: /new link/i }));
  await waitFor(() => expect(screen.getByDisplayValue('https://api/join/t2')).toBeInTheDocument());
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedCreateFolderLink', folderId: 'f1', role: 'read', rotate: true });
});

test('Remove link sends sharedDeleteFolderLink and returns to the create CTA', async () => {
  mockMessagesByType({
    sharedGetMembers: () => ({ ok: true, data: { members: [] } }),
    sharedGetFolderLink: () => ({ ok: true, data: { link: LINK } }),
    sharedDeleteFolderLink: () => ({ ok: true, data: { deleted: true } }),
  });
  renderModal(SHARED_OWNED);
  await act(async () => {});
  fireEvent.click(await screen.findByRole('button', { name: /remove link/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /create link/i })).toBeInTheDocument());
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedDeleteFolderLink', folderId: 'f1' });
});

test('creating a link on a NOT-yet-shared folder first creates the share then the link', async () => {
  await browser.storage.local.set({
    collections_index: { c1: { uid: 'c1', parentId: 'f1' } },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [] },
  });
  mockMessagesByType({
    sharedCreateShare: () => ({ ok: true, data: { members: [] } }),
    sharedCreateFolderLink: () => ({ ok: true, data: { token: 't1', role: 'read', url: 'https://api/join/t1' } }),
  });
  renderModal(FOLDER); // plain, unshared folder
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /create link/i }));
  await waitFor(() => expect(screen.getByDisplayValue('https://api/join/t1')).toBeInTheDocument());
  const types = browser.runtime.sendMessage.mock.calls.map(([m]) => m.type);
  expect(types.indexOf('sharedCreateShare')).toBeGreaterThanOrEqual(0);
  expect(types.indexOf('sharedCreateShare')).toBeLessThan(types.indexOf('sharedCreateFolderLink'));
  const [createShare] = browser.runtime.sendMessage.mock.calls.find(([m]) => m.type === 'sharedCreateShare');
  expect(createShare.collections).toEqual([{ uid: 'c1', data: { uid: 'c1', name: 'A', tabs: [] } }]);
  expect(createShare.invites).toEqual([]);
});

test('non-owner members do not see the link section', async () => {
  mockMessagesByType({});
  renderModal({ ...FOLDER, shared: { folderId: 'f1', role: 'write', members: [] } });
  await act(async () => {});
  expect(screen.queryByText('Share with link')).not.toBeInTheDocument();
  expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sharedGetFolderLink' }));
});

// Regression: React error #310 (hooks-order violation). The modal renders
// `null` while closed (folder atom null); every hook must therefore run
// BEFORE that early return, or the closed->open transition renders more
// hooks than the previous render and React throws.
test('opening the modal after a closed render does not violate the hooks order', async () => {
  browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: { members: [] } });
  const store = createStore();
  store.set(shareFolderModalState, null);
  store.set(premiumEntitlementState, PRO);
  render(<Provider store={store}><ShareFolderModal /></Provider>);

  await act(async () => {
    store.set(shareFolderModalState, FOLDER);
  });

  expect(await screen.findByText(/share folder/i)).toBeInTheDocument();
});
