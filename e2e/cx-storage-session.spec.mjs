import { test, expect } from 'crxbox';

// crxbox gap-closure: the storage.session area (Tabox doesn't use it, but the helper should
// work and be isolated from local/sync, with auto-reset between tests).

test.describe('storage.session helper', () => {
  test('set / get / clear round-trip on the session area', async ({ ext }) => {
    await ext.storage.session.set({ scratch: { hello: 'world' }, n: 42 });

    expect(await ext.storage.session.get('scratch')).toEqual({ hello: 'world' });
    expect(await ext.storage.session.get('n')).toBe(42);
    await expect(ext.storage.session).toHaveStorageValue('n', 42);

    await ext.storage.session.clear();
    expect(await ext.storage.session.get('scratch')).toBeUndefined();
    expect(await ext.storage.session.get('n')).toBeUndefined();
  });

  test('session is isolated from local and sync', async ({ ext }) => {
    await ext.storage.session.set({ key: 'session-val' });
    await ext.storage.local.set({ key: 'local-val' });
    await ext.storage.sync.set({ key: 'sync-val' });

    expect(await ext.storage.session.get('key')).toBe('session-val');
    expect(await ext.storage.local.get('key')).toBe('local-val');
    expect(await ext.storage.sync.get('key')).toBe('sync-val');
  });

  test('session area is reset between tests', async ({ ext }) => {
    // The previous test wrote `key` to session; the auto-reset should have cleared it.
    expect(await ext.storage.session.get('key')).toBeUndefined();
  });
});
