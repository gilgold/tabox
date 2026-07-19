/** @jest-environment jsdom */
// Snapshot-link modal: create/copy/update/stop-sharing a collection link.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import ShareCollectionLinkModal from '../app/ShareCollectionLinkModal';
import { shareCollectionLinkModalState } from '../app/atoms/sharedFoldersState';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { showSuccessToast, showErrorToast } from '../app/toastHelpers';

jest.mock('../app/toastHelpers', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));
import { getAIAvailability } from '../app/ai/aiClient';

const PRO = { entitled: true, refreshedAt: new Date().toISOString() };
const COLLECTION = {
  uid: 'c1', name: 'Research', color: null, parentId: 'folder-x', lastOpened: 42,
  tabs: [{ url: 'https://a.com' }], chromeGroups: [],
};

const renderModal = (collection = COLLECTION, entitlement = PRO) => {
  const store = createStore();
  store.set(shareCollectionLinkModalState, collection);
  store.set(premiumEntitlementState, entitlement);
  render(<Provider store={store}><ShareCollectionLinkModal /></Provider>);
  return store;
};

const mockMessagesByType = (byType) => {
  browser.runtime.sendMessage.mockImplementation(async (msg) => {
    const handler = byType[msg.type];
    return handler ? handler(msg) : { ok: true, data: {} };
  });
};

beforeEach(() => {
  browser.runtime.sendMessage.mockReset();
  showSuccessToast.mockClear();
  showErrorToast.mockClear();
  getAIAvailability.mockResolvedValue('available');
});

test('shows the Pro upsell when not Pro', async () => {
  renderModal(COLLECTION, { entitled: false });
  expect(screen.getByText(/Tabox Pro/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /upgrade now/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /create link/i })).not.toBeInTheDocument();
  await act(async () => {});
});

test('creates a link: sends a parentId-free snapshot and shows the url', async () => {
  mockMessagesByType({
    sharedGetCollectionLinks: () => ({ ok: true, data: { links: [] } }),
    sharedCreateCollectionLink: () => ({ ok: true, data: { token: 't1', url: 'https://api/join/t1' } }),
  });
  renderModal();
  await act(async () => {});
  fireEvent.click(await screen.findByRole('button', { name: /create link/i }));
  await waitFor(() => expect(screen.getByDisplayValue('https://api/join/t1')).toBeInTheDocument());
  const [createMsg] = browser.runtime.sendMessage.mock.calls.find(([m]) => m.type === 'sharedCreateCollectionLink');
  expect(createMsg.uid).toBe('c1');
  expect(createMsg.name).toBe('Research');
  expect(createMsg.data.parentId).toBeUndefined();
  expect(createMsg.data.lastOpened).toBeUndefined();
  expect(createMsg.data.tabs).toEqual([{ url: 'https://a.com' }]);
});

test('existing link: Copy copies, "Update link" re-uploads, "Stop sharing" deletes', async () => {
  mockMessagesByType({
    sharedGetCollectionLinks: () => ({ ok: true, data: { links: [{ uid: 'c1', token: 't1', name: 'Research', url: 'https://api/join/t1' }] } }),
    sharedCreateCollectionLink: () => ({ ok: true, data: { token: 't1', url: 'https://api/join/t1' } }),
    sharedDeleteCollectionLink: () => ({ ok: true, data: { deleted: true } }),
  });
  const writeText = jest.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderModal();
  await act(async () => {});
  expect(await screen.findByDisplayValue('https://api/join/t1')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://api/join/t1'));

  fireEvent.click(screen.getByRole('button', { name: /update link/i }));
  await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'sharedCreateCollectionLink', uid: 'c1' })
  ));

  fireEvent.click(screen.getByRole('button', { name: /stop sharing/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /create link/i })).toBeInTheDocument());
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedDeleteCollectionLink', uid: 'c1' });
});

test('surfaces server errors (link_limit) as an error toast', async () => {
  mockMessagesByType({
    sharedGetCollectionLinks: () => ({ ok: true, data: { links: [] } }),
    sharedCreateCollectionLink: () => ({ ok: false, error: 'link_limit' }),
  });
  renderModal();
  await act(async () => {});
  fireEvent.click(await screen.findByRole('button', { name: /create link/i }));
  await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('100')));
});
