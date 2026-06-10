import { test, expect } from 'crxbox';

// Exercises the chrome.storage.sync area via crxbox's ext.storage.sync helper.
// Tabox stores the Google Drive `syncFileId` in storage.sync (background-utils.js), and the
// `forceSyncReset` SW handler removes it (plus some local keys).

test.describe('storage.sync helper', () => {
  test('forceSyncReset clears syncFileId from the sync area', async ({ ext }) => {
    // Seed the sync area + the local keys forceSyncReset wipes. Deliberately NO `googleUser`
    // so the handler skips the re-auth branch (which would hit real Google APIs).
    await ext.storage.sync.set({ syncFileId: 'drive-file-123' });
    await ext.storage.local.set({ googleToken: 'tok-abc', localTimestamp: 1710000000000 });

    await expect(ext.storage.sync).toHaveStorageValue('syncFileId', 'drive-file-123');

    const ok = await ext.background.sendMessage({ type: 'forceSyncReset' });
    expect(ok).toBe(true);

    // syncFileId removed from the SYNC area...
    expect(await ext.storage.sync.get('syncFileId')).toBeUndefined();
    // ...and the local keys it also clears are gone.
    expect(await ext.storage.local.get('googleToken')).toBeUndefined();
    expect(await ext.storage.local.get('localTimestamp')).toBeUndefined();
  });

  test('sync and local areas are independent and resettable', async ({ ext }) => {
    await ext.storage.sync.set({ syncFileId: 'abc' });
    await ext.storage.local.set({ syncFileId: 'local-different' });

    // Each area reads its own value (no cross-contamination).
    expect(await ext.storage.sync.get('syncFileId')).toBe('abc');
    expect(await ext.storage.local.get('syncFileId')).toBe('local-different');

    // clear() empties only the sync area.
    await ext.storage.sync.clear();
    expect(await ext.storage.sync.get('syncFileId')).toBeUndefined();
    expect(await ext.storage.local.get('syncFileId')).toBe('local-different');
  });
});
