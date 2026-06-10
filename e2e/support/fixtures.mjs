// Shared seed builders + helpers for Tabox e2e specs.
// crxbox resets storage between tests, so seed inside each test before opening a page.

export const T = 1_710_000_000_000;

// Tab record for seeding a collection's `tabs` array.
export const tab = (uid, title, { groupUid, groupId } = {}) => ({
  uid,
  title,
  url: `https://${uid}.example.com`,
  groupId: groupId ?? -1,
  ...(groupUid !== undefined ? { groupUid } : {}),
});

export const collection = (uid, name, { order = 0, parentId = null, tabs, chromeGroups } = {}) => ({
  uid,
  name,
  color: '#4fc3f7',
  parentId,
  order,
  tabs: tabs ?? [{ title: `${name} tab`, url: `https://${uid}.example.com` }],
  chromeGroups: chromeGroups ?? [],
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
});

export const collectionIndexEntry = (name, { order = 0, parentId = null, tabCount = 1 } = {}) => ({
  name,
  type: 'collection',
  tabCount,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color: '#4fc3f7',
  size: 0,
  parentId,
  order,
});

export const folder = (uid, name, { order = 0 } = {}) => ({
  uid,
  name,
  type: 'folder',
  color: '#ff9800',
  collapsed: false,
  collectionCount: 0,
  order,
  lastUpdated: T,
  createdOn: T,
});

export const folderIndexEntry = (name, { order = 0 } = {}) => ({
  name,
  type: 'folder',
  color: '#ff9800',
  collapsed: false,
  collectionCount: 0,
  order,
  lastUpdated: T,
  createdOn: T,
  size: 0,
});

// Build a full storage seed from a flat spec of collections/folders.
// A collection spec may include optional `tabs` / `chromeGroups` arrays;
// when `tabs` is given it is used verbatim and the index entry's tabCount
// is derived from it. Omitted → single default tab (legacy behavior).
export function buildSeed({ collections = [], folders = [] } = {}) {
  const seed = { collections_index: {}, folders_index: {} };
  collections.forEach((c, i) => {
    const order = c.order ?? i;
    const parentId = c.parentId ?? null;
    seed.collections_index[c.uid] = collectionIndexEntry(c.name, {
      order,
      parentId,
      tabCount: c.tabs ? c.tabs.length : 1,
    });
    seed[`collection_${c.uid}`] = collection(c.uid, c.name, {
      order,
      parentId,
      tabs: c.tabs,
      chromeGroups: c.chromeGroups,
    });
  });
  folders.forEach((f, i) => {
    const order = f.order ?? i;
    seed.folders_index[f.uid] = folderIndexEntry(f.name, { order });
    seed[`folder_${f.uid}`] = folder(f.uid, f.name, { order });
  });
  return seed;
}

// Open the extension's full-page view as a normal page (uses crxbox's openPage helper).
export async function openFullPage(ext) {
  return ext.openPage('fullpage.html');
}
