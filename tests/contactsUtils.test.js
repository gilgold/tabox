import { browser } from '../static/globals';
import { loadContacts, saveContact, searchContacts } from '../app/utils/contactsUtils';

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

beforeEach(() => installStorageMock());

test('saveContact dedupes by email (case-insensitive) and search matches name or email', async () => {
  await saveContact({ name: 'Dana', email: 'Dana@X.com' });
  await saveContact({ name: 'Dana Updated', email: 'dana@x.com' });
  expect(await loadContacts()).toEqual([{ name: 'Dana Updated', email: 'dana@x.com' }]);
  expect(await searchContacts('dan')).toHaveLength(1);
  expect(await searchContacts('x.com')).toHaveLength(1);
  expect(await searchContacts('zzz')).toHaveLength(0);
});

test('loadContacts returns [] when nothing saved', async () => {
  expect(await loadContacts()).toEqual([]);
});

test('searchContacts returns [] for an empty query', async () => {
  await saveContact({ name: 'Dana', email: 'dana@x.com' });
  expect(await searchContacts('')).toEqual([]);
  expect(await searchContacts('   ')).toEqual([]);
});
