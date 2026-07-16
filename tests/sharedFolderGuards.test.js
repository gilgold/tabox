import { isSharedFolder, isReadOnlySharedFolder, canEditFolder, guardFolderEdit } from '../app/utils/sharedFolderUtils';

test('role predicates', () => {
  expect(isSharedFolder({ shared: { folderId: 'f', role: 'read' } })).toBe(true);
  expect(isSharedFolder({})).toBe(false);
  expect(isReadOnlySharedFolder({ shared: { folderId: 'f', role: 'read' } })).toBe(true);
  expect(isReadOnlySharedFolder({ shared: { folderId: 'f', role: 'write' } })).toBe(false);
  expect(canEditFolder(null)).toBe(true);                                    // no folder = root, editable
  expect(canEditFolder({ shared: { folderId: 'f', role: 'owner' } })).toBe(true);
  expect(canEditFolder({ shared: { folderId: 'f', role: 'read' } })).toBe(false);
});

test('guardFolderEdit opens the modal exactly when blocked', () => {
  const open = jest.fn();
  expect(guardFolderEdit({ shared: { folderId: 'f', role: 'read' } }, open)).toBe(false);
  expect(open).toHaveBeenCalledTimes(1);
  expect(guardFolderEdit({ shared: { folderId: 'f', role: 'write' } }, open)).toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
});

describe('folderOperations guard wiring', () => {
  jest.mock('../app/utils/storageUtils', () => ({
    saveSingleFolder: jest.fn(),
    loadSingleFolder: jest.fn(),
    deleteSingleFolder: jest.fn(),
    loadAllFolders: jest.fn(),
    updateFoldersOrder: jest.fn(),
    updateFolderCollectionCount: jest.fn(),
    saveSingleCollection: jest.fn(),
    loadSingleCollection: jest.fn(),
    deleteSingleCollection: jest.fn(),
    batchDeleteCollections: jest.fn(),
    batchUpdateCollections: jest.fn(),
    loadCollectionsIndex: jest.fn(),
    loadAllCollections: jest.fn(),
  }));

  jest.mock('../app/utils/sharedSync', () => ({
    triggerBackgroundSync: jest.fn(),
  }));

  const storageUtils = require('../app/utils/storageUtils');
  const sharedSync = require('../app/utils/sharedSync');
  const { moveCollectionToFolder, removeCollectionFromFolder, updateFolderName } = require('../app/utils/folderOperations');

  beforeEach(() => {
    jest.clearAllMocks();
    storageUtils.saveSingleCollection.mockResolvedValue(true);
    storageUtils.saveSingleFolder.mockResolvedValue(true);
    storageUtils.updateFolderCollectionCount.mockResolvedValue(true);
    sharedSync.triggerBackgroundSync.mockResolvedValue(true);
  });

  test('moveCollectionToFolder blocks (without writing) when the target folder is read-only shared', async () => {
    storageUtils.loadSingleFolder.mockImplementation(async (uid) => (
      uid === 'folder-target' ? { uid: 'folder-target', shared: { folderId: 'folder-target', role: 'read' } } : { uid }
    ));
    storageUtils.loadSingleCollection.mockResolvedValue({ uid: 'collection-1', parentId: 'folder-source' });

    const result = await moveCollectionToFolder('collection-1', 'folder-target');

    expect(result).toEqual({ blocked: true });
    expect(storageUtils.saveSingleCollection).not.toHaveBeenCalled();
  });

  test('moveCollectionToFolder blocks (without writing) when the source folder is read-only shared', async () => {
    storageUtils.loadSingleFolder.mockImplementation(async (uid) => (
      uid === 'folder-source' ? { uid: 'folder-source', shared: { folderId: 'folder-source', role: 'read' } } : { uid }
    ));
    storageUtils.loadSingleCollection.mockResolvedValue({ uid: 'collection-1', parentId: 'folder-source' });

    const result = await moveCollectionToFolder('collection-1', 'folder-target');

    expect(result).toEqual({ blocked: true });
    expect(storageUtils.saveSingleCollection).not.toHaveBeenCalled();
  });

  test('moveCollectionToFolder proceeds normally when both folders are writable', async () => {
    storageUtils.loadSingleFolder.mockImplementation(async (uid) => (
      uid === 'folder-target'
        ? { uid: 'folder-target', shared: { folderId: 'folder-target', role: 'write' } }
        : { uid: 'folder-source', shared: { folderId: 'folder-source', role: 'owner' } }
    ));
    storageUtils.loadSingleCollection.mockResolvedValue({ uid: 'collection-1', parentId: 'folder-source' });

    const result = await moveCollectionToFolder('collection-1', 'folder-target');

    expect(result).toBe(true);
    expect(storageUtils.saveSingleCollection).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'collection-1', parentId: 'folder-target' }),
      true,
    );
  });

  test('removeCollectionFromFolder blocks (without writing) when the source folder is read-only shared', async () => {
    storageUtils.loadSingleCollection.mockResolvedValue({ uid: 'collection-1', parentId: 'folder-source' });
    storageUtils.loadSingleFolder.mockResolvedValue({
      uid: 'folder-source',
      shared: { folderId: 'folder-source', role: 'read' },
    });

    const result = await removeCollectionFromFolder('collection-1');

    expect(result).toEqual({ blocked: true });
    expect(storageUtils.saveSingleCollection).not.toHaveBeenCalled();
  });

  test('removeCollectionFromFolder proceeds normally when the source folder is writable', async () => {
    storageUtils.loadSingleCollection.mockResolvedValue({ uid: 'collection-1', parentId: 'folder-source' });
    storageUtils.loadSingleFolder.mockResolvedValue({
      uid: 'folder-source',
      shared: { folderId: 'folder-source', role: 'write' },
    });

    const result = await removeCollectionFromFolder('collection-1');

    expect(result).toBe(true);
    expect(storageUtils.saveSingleCollection).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'collection-1', parentId: null }),
      true,
    );
  });

  test('updateFolderName blocks renaming a read-only shared folder', async () => {
    storageUtils.loadSingleFolder.mockResolvedValue({
      uid: 'folder-1',
      name: 'Original',
      shared: { folderId: 'folder-1', role: 'read' },
    });

    const result = await updateFolderName('folder-1', 'Renamed');

    expect(result).toBe(false);
    expect(storageUtils.saveSingleFolder).not.toHaveBeenCalled();
  });

  test('updateFolderName allows renaming a folder the user can write to', async () => {
    storageUtils.loadSingleFolder.mockResolvedValue({
      uid: 'folder-1',
      name: 'Original',
      shared: { folderId: 'folder-1', role: 'write' },
    });

    const result = await updateFolderName('folder-1', 'Renamed');

    expect(result).toBe(true);
    expect(storageUtils.saveSingleFolder).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'folder-1', name: 'Renamed' }),
      true,
    );
  });
});

describe('useCollectionOperations guard wiring', () => {
  jest.mock('../app/utils', () => ({
    downloadTextFile: jest.fn(),
    getCurrentTabsAndGroups: jest.fn(),
    generateCopyName: jest.fn(),
    applyUid: jest.fn((value) => value),
  }));

  jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
    showInfoToast: jest.fn(),
  }));

  jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
    deleteSingleCollection: jest.fn(),
    updateFolderCollectionCount: jest.fn(),
  }));

  const { act } = require('@testing-library/react');
  const { renderWithProviders } = require('./helpers/renderWithProviders');
  const toastHelpers = require('../app/toastHelpers');
  const storageUtils = require('../app/utils/storageUtils');
  const { useCollectionOperations } = require('../app/useCollectionOperations');
  const { noPermissionOpenState } = require('../app/atoms/sharedFoldersState');

  let latestOperations;
  function HookHarness(props) {
    latestOperations = useCollectionOperations(props);
    return null;
  }

  const READ_ONLY_FOLDER = { uid: 'folder-1', shared: { folderId: 'folder-1', role: 'read' } };

  const collection = {
    uid: 'collection-1',
    name: 'Collection One',
    parentId: 'folder-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    storageUtils.loadAllCollections.mockResolvedValue([]);
    storageUtils.deleteSingleCollection.mockResolvedValue(true);
    storageUtils.updateFolderCollectionCount.mockResolvedValue(true);
  });

  test('_handleDelete is blocked and opens the no-permission modal for a read-only shared folder', async () => {
    const updateRemoteData = jest.fn(async () => true);
    const { store } = renderWithProviders(
      <HookHarness
        collection={collection}
        folders={[READ_ONLY_FOLDER]}
        updateCollection={jest.fn(async () => true)}
        updateRemoteData={updateRemoteData}
      />,
    );

    await act(async () => {
      await latestOperations._handleDelete();
    });

    expect(storageUtils.deleteSingleCollection).not.toHaveBeenCalled();
    expect(toastHelpers.showUndoToast).not.toHaveBeenCalled();
    expect(store.get(noPermissionOpenState)).toBe(true);
  });

  test('_handleDelete undo callback filters out collections whose parent folder is read-only shared', async () => {
    const updateRemoteData = jest.fn(async () => true);
    const previousCollections = [
      { uid: 'safe-collection', parentId: null },
      { uid: 'shared-collection', parentId: 'folder-1' },
    ];
    storageUtils.loadAllCollections
      .mockResolvedValueOnce(previousCollections)
      .mockResolvedValueOnce([{ uid: 'after-delete' }]);

    const writableCollection = { uid: 'collection-2', name: 'Writable', parentId: null };

    renderWithProviders(
      <HookHarness
        collection={writableCollection}
        folders={[READ_ONLY_FOLDER]}
        updateCollection={jest.fn(async () => true)}
        updateRemoteData={updateRemoteData}
      />,
    );

    await act(async () => {
      await latestOperations._handleDelete();
    });

    expect(toastHelpers.showUndoToast).toHaveBeenCalledTimes(1);
    const undoCallback = toastHelpers.showUndoToast.mock.calls[0][3];

    await act(async () => {
      await undoCallback();
    });

    expect(updateRemoteData).toHaveBeenCalledWith([{ uid: 'safe-collection', parentId: null }]);
  });
});
