/* eslint-disable no-undef */
try {
  importScripts('browser-polyfill.min.js');
  importScripts('sync-session-state.js');
  importScripts('sync-transport.js');
  importScripts('sync-merge.js');
  importScripts('sync-apply.js');
  importScripts('sync-throttle.js');
  importScripts('background-utils.js');
  importScripts('ai-client.js');
  importScripts('ai-planners.js');
  importScripts('ai-storage.js');
  importScripts('ai-registry.js');
  importScripts('ai-engine.js');
  importScripts('ai-task-auto-rename.js');
  importScripts('ai-task-auto-arrange.js');
  importScripts('ai-task-smart-organize.js');
}
catch (e) {
  console.error(e);
}
  const syncSessionStateApi = typeof require === 'function'
    ? require('./sync-session-state.js')
    : globalThis.TaboxSyncSessionState;
  const {
    SYNC_SESSION_STATE_KEY,
    SYNC_SESSION_STATUS,
    writeSyncSessionState
  } = syncSessionStateApi;
  let updateInProgress = false;

  // Sync coalescing to prevent overlapping sync operations.
  // The first call runs immediately; a call made while a sync is in flight is
  // coalesced into a single trailing run that fires as soon as the current one
  // finishes, and the caller awaits it. This ensures a closely-following sync
  // (e.g. deleting a just-duplicated collection) is never silently dropped.
  const syncThrottleApi = typeof require === 'function'
    ? require('./sync-throttle.js')
    : globalThis.TaboxSyncThrottle;
  const throttleSync = syncThrottleApi.createSyncThrottle();


  // Auto-update debouncing - wait 2 seconds after last event
  let autoUpdateTimeouts = new Map();
  const debounceAutoUpdate = (windowId, timeDelay = 2000, rebuildContextMenus = false) => {
    // Clear existing timeout for this window
    if (autoUpdateTimeouts.has(windowId)) {
      clearTimeout(autoUpdateTimeouts.get(windowId));
    }
    
    // Set new timeout
    const timeout = setTimeout(() => {
      handleAutoUpdate(windowId, 1, rebuildContextMenus);
      autoUpdateTimeouts.delete(windowId);
    }, timeDelay);
    
    autoUpdateTimeouts.set(windowId, timeout);
  };

const AUTO_BACKUP_ALARM = 'auto-backup-alarm';
const BACKGROUND_SYNC_ALARM = 'background-sync-alarm';
const BACKGROUND_SYNC_PERIOD_MINUTES = 6 * 60;
const TOOLBAR_FULLPAGE_SETTING_KEY = 'chkToolbarIconOpensFullPage';

async function updateSharedSyncSessionState(overrides = {}) {
  const { googleUser, googleRefreshToken } = await browser.storage.local.get(['googleUser', 'googleRefreshToken']);

  return writeSyncSessionState(browser.storage.local, {
    user: overrides.user !== undefined ? overrides.user : (googleUser || null),
    hasRefreshToken: overrides.hasRefreshToken !== undefined ? overrides.hasRefreshToken : Boolean(googleRefreshToken),
    ...overrides
  });
}

async function openExtensionFullPage() {
  const fullPageUrl = browser.runtime.getURL('fullpage.html');
  const existingTabs = await browser.tabs.query({
    currentWindow: true,
    url: fullPageUrl
  });
  const existingTab = existingTabs[0];

  if (existingTab && existingTab.id != null) {
    await browser.tabs.update(existingTab.id, { active: true });
    return existingTab;
  }

  return browser.tabs.create({ url: fullPageUrl });
}

async function applyToolbarLaunchBehavior() {
  const { [TOOLBAR_FULLPAGE_SETTING_KEY]: openInFullPage } = await browser.storage.local.get(TOOLBAR_FULLPAGE_SETTING_KEY);
  const popup = openInFullPage ? '' : 'index.html';
  await browser.action.setPopup({ popup });
}

async function shouldRunBackgroundSync() {
  const {
    googleRefreshToken,
    [SYNC_SESSION_STATE_KEY]: syncSessionState
  } = await browser.storage.local.get(['googleRefreshToken', SYNC_SESSION_STATE_KEY]);
  return Boolean(googleRefreshToken || syncSessionState?.hasRefreshToken);
}

async function ensureBackgroundSyncAlarm() {
  const syncEnabled = await shouldRunBackgroundSync();

  if (!syncEnabled) {
    await browser.alarms.clear(BACKGROUND_SYNC_ALARM);
    return false;
  }

  const alarms = await browser.alarms.getAll();
  const existingAlarm = alarms.find(alarm => alarm.name === BACKGROUND_SYNC_ALARM);
  const hasExpectedPeriod = existingAlarm?.periodInMinutes === BACKGROUND_SYNC_PERIOD_MINUTES;

  if (!hasExpectedPeriod) {
    if (existingAlarm) {
      await browser.alarms.clear(BACKGROUND_SYNC_ALARM);
    }

    browser.alarms.create(BACKGROUND_SYNC_ALARM, {
      delayInMinutes: BACKGROUND_SYNC_PERIOD_MINUTES,
      periodInMinutes: BACKGROUND_SYNC_PERIOD_MINUTES
    });
  }

  return true;
}

const BACKUP_GROUP_TITLES = {
  auto: 'Auto Backups',
  preSync: 'Pre-Sync Backups',
  version: 'Version Backups'
};

function isFullCollectionSnapshot(backup) {
  return Array.isArray(backup?.tabsArray)
    && (backup.tabsArray.length === 0 || Array.isArray(backup.tabsArray[0]?.tabs));
}

function synthesizeBackupFolders(backup = {}, fallbackFolders = []) {
  const existingFolders = Array.isArray(backup.foldersArray) ? backup.foldersArray : [];
  const fallbackById = new Map((fallbackFolders || []).map((folder) => [folder.uid, folder]));
  const knownFolderIds = new Set(existingFolders.map((folder) => folder.uid).filter(Boolean));
  const syntheticFolders = [];

  (backup.tabsArray || []).forEach((collection) => {
    if (collection?.parentId && !knownFolderIds.has(collection.parentId)) {
      knownFolderIds.add(collection.parentId);
      const fallbackFolder = fallbackById.get(collection.parentId);
      syntheticFolders.push({
        uid: collection.parentId,
        name: fallbackFolder?.name || 'Unknown Folder',
        color: fallbackFolder?.color || null,
        collapsed: fallbackFolder?.collapsed || false
      });
    }
  });

  return [...existingFolders, ...syntheticFolders];
}

function buildBackupDescriptor(backup, source, index = 0) {
  const fullSnapshot = isFullCollectionSnapshot(backup);
  const folders = fullSnapshot ? synthesizeBackupFolders(backup) : [];
  const collectionCount = backup?.collectionCount ?? backup?.tabsArray?.length ?? 0;

  return {
    id: source === 'version' ? 'version' : `${source}:${index}`,
    source,
    index,
    label: backup?.label || backup?.reason || (source === 'version' ? `Version ${backup?.version || 'backup'}` : null),
    timestamp: backup?.timestamp || Date.now(),
    collectionCount,
    folderCount: backup?.folderCount ?? folders.length,
    canPreview: Array.isArray(backup?.tabsArray),
    canSelectiveRestore: fullSnapshot,
    canOverwrite: fullSnapshot,
    previewType: fullSnapshot ? 'full_export' : 'metadata_only'
  };
}

function buildGroupedBackupOptions({ preSyncBackups = [], autoBackups = [], backup = null }) {
  const groups = [];
  const pushGroup = (key, items) => {
    if (items.length > 0) {
      groups.push({
        key,
        title: BACKUP_GROUP_TITLES[key],
        items
      });
    }
  };

  pushGroup('auto', autoBackups.map((item, index) => buildBackupDescriptor(item, 'auto', index)));
  pushGroup('preSync', preSyncBackups.map((item, index) => buildBackupDescriptor(item, 'preSync', index)));
  if (backup) {
    pushGroup('version', [buildBackupDescriptor(backup, 'version', 0)]);
  }

  return groups;
}

async function resolveBackupById(backupId) {
  const { preSyncBackups = [], autoBackups = [], backup } = await browser.storage.local.get(['preSyncBackups', 'autoBackups', 'backup']);

  if (backupId === 'version') {
    return { source: 'version', index: 0, backup };
  }

  const [source, rawIndex] = String(backupId || '').split(':');
  const index = Number(rawIndex);

  if (source === 'auto' && Number.isInteger(index)) {
    return { source, index, backup: autoBackups[index] || null };
  }

  if (source === 'preSync' && Number.isInteger(index)) {
    return { source, index, backup: preSyncBackups[index] || null };
  }

  return { source: null, index: -1, backup: null };
}

async function buildBackupPreviewResponse(backupId) {
  const { backup } = await resolveBackupById(backupId);

  if (!backup || !Array.isArray(backup.tabsArray)) {
    return undefined;
  }

  if (!isFullCollectionSnapshot(backup)) {
    return {
      kind: 'metadata_only',
      items: backup.tabsArray
    };
  }

  const currentFolders = await loadAllFoldersBG();

  return {
    kind: 'full_export',
    payload: {
      type: 'full_export',
      folders: synthesizeBackupFolders(backup, currentFolders),
      collections: backup.tabsArray
    }
  };
}

async function createEmergencySelectionBackup(reason) {
  const [tabsArray, foldersArray] = await Promise.all([
    loadAllCollectionsBG(true),
    loadAllFoldersBG()
  ]);
  const { autoBackups = [] } = await browser.storage.local.get('autoBackups');
  const nextAutoBackups = [{
    timestamp: Date.now(),
    reason,
    tabsArray,
    foldersArray
  }, ...autoBackups].slice(0, 3);

  await browser.storage.local.set({ autoBackups: nextAutoBackups });
}

async function overwriteBackupSelection(payload = {}) {
  const selectedCollections = Array.isArray(payload.collections) ? payload.collections : [];
  const selectedFolders = Array.isArray(payload.folders) ? payload.folders : [];
  // Full-backup restores ask to mirror the backup exactly: folders that aren't part
  // of the backup must be removed. Selective (pick-items) restores leave them alone.
  const pruneMissingFolders = payload.pruneMissingFolders === true;
  const currentFolders = await loadAllFoldersBG();
  const currentCollections = await loadAllCollectionsBG(true);

  await createEmergencySelectionBackup('Before selective overwrite restore');

  const currentFolderIds = new Set(currentFolders.map((folder) => folder.uid));
  const selectedFolderIds = new Set(selectedFolders.map((folder) => folder.uid));
  const validFolderIds = new Set([...currentFolderIds, ...selectedFolderIds]);
  const impactedFolderIds = new Set(selectedFolders.map((folder) => folder.uid));

  let overwrittenCollections = 0;
  let overwrittenFolders = 0;

  for (const collection of selectedCollections) {
    const existingCollection = currentCollections.find((entry) => entry.uid === collection.uid);
    if (existingCollection?.parentId) {
      impactedFolderIds.add(existingCollection.parentId);
    }

    const normalizedParentId = collection.parentId && validFolderIds.has(collection.parentId)
      ? collection.parentId
      : null;

    await saveSingleCollectionBG({
      ...collection,
      parentId: normalizedParentId
    }, true);

    if (normalizedParentId) {
      impactedFolderIds.add(normalizedParentId);
    }

    overwrittenCollections++;
  }

  for (const folder of selectedFolders) {
    await saveSingleFolderBG(folder, true);
    overwrittenFolders++;
  }

  for (const folderId of impactedFolderIds) {
    if (!folderId) continue;
    const folder = selectedFolders.find((entry) => entry.uid === folderId)
      || currentFolders.find((entry) => entry.uid === folderId)
      || await loadSingleFolderBG(folderId);
    if (folder) {
      await saveSingleFolderBG(folder);
    }
  }

  let removedFolders = 0;
  if (pruneMissingFolders) {
    const foldersToRemove = currentFolders.filter((folder) => !selectedFolderIds.has(folder.uid));
    if (foldersToRemove.length > 0) {
      const removeFolderIds = new Set(foldersToRemove.map((folder) => folder.uid));
      // Re-home any collection still pointing at a folder we're about to remove so we
      // never orphan or destroy user data — they fall back to the root (no folder).
      const latestCollections = await loadAllCollectionsBG(true);
      for (const collection of latestCollections) {
        if (collection.parentId && removeFolderIds.has(collection.parentId)) {
          await saveSingleCollectionBG({ ...collection, parentId: null }, true);
        }
      }
      for (const folder of foldersToRemove) {
        const deleted = await deleteSingleFolderBG(folder.uid);
        if (deleted) {
          removedFolders++;
        }
      }
    }
  }

  await forceLegacyStorageSync();

  return {
    success: true,
    overwrittenCollections,
    overwrittenFolders,
    removedFolders
  };
}

async function runBackgroundSync() {
  if (!await shouldRunBackgroundSync()) {
    await updateSharedSyncSessionState({
      status: SYNC_SESSION_STATUS.DISABLED,
      isEnabled: false,
      hasRefreshToken: false,
      user: null,
      error: null
    });
    await browser.alarms.clear(BACKGROUND_SYNC_ALARM);
    return false;
  }

  await updateSharedSyncSessionState({
    status: SYNC_SESSION_STATUS.SYNCING,
    error: null
  });

  const token = await getAuthToken();
  if (token === false) {
    logSyncOperation('error', 'Background sync skipped - failed to get auth token');
    await updateSharedSyncSessionState({
      status: SYNC_SESSION_STATUS.AUTH_REFRESHING
    });
    return false;
  }

  const result = await syncData(token);
  if (result === false) {
    logSyncOperation('error', 'Background sync failed');
    await updateSharedSyncSessionState({
      status: SYNC_SESSION_STATUS.ERROR
    });
    return false;
  }

  logSyncOperation('success', 'Background sync completed', {
    mode: result === 'already_in_progress' ? 'already_in_progress' : 'sync'
  });
  await updateSharedSyncSessionState({
    status: SYNC_SESSION_STATUS.ACTIVE,
    error: null
  });
  return true;
}

async function setInitialOptions() {
  const {
    tabsArray,
    chkOpenNewWindow,
    chkToolbarIconOpensFullPage,
    collectionsToTrack,
    localTimestamp,
    chkEnableTabDiscard,
    currentSortValue,
    currentSortAscending,
  } = await browser.storage.local.get([
    'tabsArray',
    'chkOpenNewWindow',
    TOOLBAR_FULLPAGE_SETTING_KEY,
    'collectionsToTrack',
    'localTimestamp',
    'chkEnableTabDiscard',
    'currentSortValue',
    'currentSortAscending',
  ]);
  if (tabsArray == null) {
    // Only default tabsArray to empty if indexed storage also has no data,
    // otherwise the popup migration may read this empty array and skip migration.
    const index = await loadCollectionsIndexBG();
    if (Object.keys(index).length === 0) {
      await browser.storage.local.set({ tabsArray: [] });
    }
  }
  if (localTimestamp == null) {
    await browser.storage.local.set({ localTimestamp: 0 });
  }
  if (collectionsToTrack == null) {
    await browser.storage.local.set({ collectionsToTrack: [] });
  }
  if (chkOpenNewWindow == null) {
    await browser.storage.local.set({ chkOpenNewWindow: true });
  }
  if (chkToolbarIconOpensFullPage == null) {
    await browser.storage.local.set({ [TOOLBAR_FULLPAGE_SETTING_KEY]: false });
  }
  if (chkEnableTabDiscard == null) {
    // Smart tab loading defaults OFF. It previously defaulted ON and was force-enabled
    // for every user on update, which (combined with the ad-blocker-blocked deferred
    // page) broke tab restores at scale. Users can opt in from Settings.
    await browser.storage.local.set({ chkEnableTabDiscard: false });
  }
  if (currentSortValue == null) {
    await browser.storage.local.set({ currentSortValue: 'DATE' });
  }
  if (currentSortAscending === undefined) {
    await browser.storage.local.set({ currentSortAscending: true });
  }
}

// Badge update throttling to prevent excessive updates
let badgeUpdateTimeout = null;
let lastBadgeUpdate = 0;
const BADGE_UPDATE_THROTTLE = 1000; // Update at most once per second

async function handleBadge() {
  // Throttle badge updates to reduce CPU usage
  const now = Date.now();
  if (now - lastBadgeUpdate < BADGE_UPDATE_THROTTLE) {
    // Schedule a deferred update if not already scheduled
    if (!badgeUpdateTimeout) {
      badgeUpdateTimeout = setTimeout(() => {
        badgeUpdateTimeout = null;
        handleBadge();
      }, BADGE_UPDATE_THROTTLE);
    }
    return;
  }
  
  lastBadgeUpdate = now;
  
  const { chkShowBadge } = await browser.storage.local.get('chkShowBadge');
  if (!chkShowBadge) {
    browser.action.setBadgeText({ text: '' });
    return;
  }
  
  try {
  const tabCount = (await browser.tabs.query({ windowId: browser.windows.WINDOW_ID_CURRENT })).length;
  let badgeColor;
  if (tabCount <= 20) badgeColor = '#07A361';
    else if (tabCount > 20 && tabCount <= 50) badgeColor = '#DF9402';
    else badgeColor = '#DB392F';
    
  browser.action.setBadgeBackgroundColor({ color: badgeColor });
  browser.action.setBadgeText({ text: tabCount.toString() });
  } catch {
    // Silently handle errors (e.g., no current window)
    browser.action.setBadgeText({ text: '' });
  }
}

// Helper function to detect if collection content has changed
function collectionsHaveChanges(oldCollection, newCollection) {
  // Compare tab count first (quick check)
  if (oldCollection.tabs?.length !== newCollection.tabs?.length) {
    return true;
  }
  
  // Compare tab URLs and titles
  for (let i = 0; i < (oldCollection.tabs?.length || 0); i++) {
    const oldTab = oldCollection.tabs[i];
    const newTab = newCollection.tabs[i];
    if (oldTab.url !== newTab.url || oldTab.title !== newTab.title || oldTab.groupId !== newTab.groupId) {
      return true;
    }
  }
  
  // Compare chrome groups count
  if (oldCollection.chromeGroups?.length !== newCollection.chromeGroups?.length) {
    return true;
  }
  
  // Compare chrome group details
  for (let i = 0; i < (oldCollection.chromeGroups?.length || 0); i++) {
    const oldGroup = oldCollection.chromeGroups[i];
    const newGroup = newCollection.chromeGroups[i];
    if (oldGroup.id !== newGroup.id || oldGroup.title !== newGroup.title || oldGroup.color !== newGroup.color) {
      return true;
    }
  }
  
  return false; // No changes detected
}

// Enhanced handleAutoUpdate with NEW INDEXED STORAGE - Much faster performance!
async function handleAutoUpdate(windowId, timeDelay = 1, rebuildContextMenus = false) {
  try {
    const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
    if (!chkEnableAutoUpdate) { return; }
    
    const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    if (!collectionsToTrack || collectionsToTrack.length === 0) return;
    
    const tracked = collectionsToTrack.find(c => c.windowId === windowId);
    if (!tracked) { return; }
    
    // Verify window still exists
    try {
      await browser.windows.get(windowId);
    } catch {
      const updatedTracking = collectionsToTrack.filter(c => c.windowId !== windowId);
      await browser.storage.local.set({ collectionsToTrack: updatedTracking });
      return;
    }
    
    // 🚀 NEW: Load single collection instead of entire array (MASSIVE performance improvement!)
    const existingCollection = await loadSingleCollectionBG(tracked.collectionUid);
    if (!existingCollection) {
      const updatedTracking = collectionsToTrack.filter(c => c.collectionUid !== tracked.collectionUid);
      await browser.storage.local.set({ collectionsToTrack: updatedTracking });
      return;
    }
    
    const newCollection = await updateCollection(existingCollection, windowId);
    if (!newCollection) {
      console.error('Failed to update collection');
      return;
    }
    
    // 🔍 NEW: Only save if collection content has actually changed
    const hasChanges = collectionsHaveChanges(existingCollection, newCollection);
    if (hasChanges) {
      // Update timestamp only when there are actual changes
      newCollection.lastUpdated = Date.now();
      
      // 🚀 NEW: Save single collection instead of entire array (MASSIVE performance improvement!)
      const saveSuccess = await saveSingleCollectionBG(newCollection, true); // Force timestamp update
      if (!saveSuccess) {
        console.error('Failed to save updated collection using indexed storage');
        return;
      }

      browser.runtime.sendMessage({
        type: 'collectionAutoUpdated',
        collection: newCollection
      }).catch(() => {});
    }
    
    // Note: Legacy storage will be updated during sync operations
    // No need to load all 42 collections on every tab event - that's inefficient!
    
    if (updateInProgress) { return; }
    updateInProgress = true;
    
    if (rebuildContextMenus && JSON.stringify(existingCollection.chromeGroups || []) !== JSON.stringify(newCollection.chromeGroups || [])) {
      await handleContextMenuCreation();
    }
    
    setTimeout(async () => {
      try {
        await handleRemoteUpdate();
      } catch (error) {
        console.error('Error in delayed remote update:', error);
      } finally {
        updateInProgress = false;
      }
    }, timeDelay);
    
  } catch (error) {
    console.error('Exception in handleAutoUpdate:', error);
    updateInProgress = false;
  }
}

// Enhanced handleRemoteUpdate with better error handling and retry logic
async function handleRemoteUpdate(retryCount = 0, maxRetries = 2) {
  try {
    const { googleUser } = await browser.storage.local.get('googleUser');
    if (!googleUser) { 
      return false; 
    }
    
    // Check if we have a refresh token before attempting
    const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
    if (!googleRefreshToken) {
      logSyncOperation('info', 'No refresh token available for remote update');
      return false;
    }
    
    // 🛡️ SAFETY CHECK: Early detection of empty local data
    // This prevents wasting resources on operations that will be blocked anyway
    const localCollections = await loadAllCollectionsBG(true);
    const localCollectionCount = localCollections ? localCollections.length : 0;
    
    if (localCollectionCount === 0) {
      // Check if this looks like a newly initialized device
      const { localTimestamp } = await browser.storage.local.get('localTimestamp');
      if (!localTimestamp || localTimestamp === 0) {
        logSyncOperation('info', 'Skipping remote update - device appears newly initialized with no local data');
        return true; // Return true to prevent retry loops - this is expected state for new devices
      }
      logSyncOperation('info', 'Local data is empty - remote update will verify server state before proceeding');
    }
    
    const token = await getAuthToken();
    if (token === false) {
      await updateSharedSyncSessionState({
        status: SYNC_SESSION_STATUS.AUTH_REFRESHING
      });
      if (retryCount < maxRetries) {
        logSyncOperation('info', `Auth token failed, retrying remote update`, { 
          attempt: retryCount + 1, 
          maxRetries: maxRetries + 1 
        });
        
        // Wait a bit before retry to allow token refresh
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return await handleRemoteUpdate(retryCount + 1, maxRetries);
      } else {
        logSyncOperation('error', 'Failed to get auth token after all retries for remote update');
        return false;
      }
    }
    
    await updateSharedSyncSessionState({
      status: SYNC_SESSION_STATUS.SYNCING,
      error: null
    });
    const result = await syncData(token);
    if (result === 'already_in_progress') {
      // Operation already in progress, consider it success
      logSyncOperation('info', 'Remote update already in progress');
      await updateSharedSyncSessionState({
        status: SYNC_SESSION_STATUS.SYNCING
      });
      return true;
    }
    if (result === false) {
      await updateSharedSyncSessionState({
        status: SYNC_SESSION_STATUS.ERROR
      });
      if (retryCount < maxRetries) {
        logSyncOperation('info', `Remote update failed, retrying`, { 
          attempt: retryCount + 1, 
          maxRetries: maxRetries + 1 
        });
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        return await handleRemoteUpdate(retryCount + 1, maxRetries);
      } else {
        logSyncOperation('error', 'Remote update failed after all retries');
        return false;
      }
    }
    
    logSyncOperation('success', 'Remote update completed successfully', { 
      attempts: retryCount + 1 
    });
    await updateSharedSyncSessionState({
      status: SYNC_SESSION_STATUS.ACTIVE,
      error: null
    });
    return true;
  } catch (error) {
    await updateSharedSyncSessionState({
      status: SYNC_SESSION_STATUS.ERROR,
      error: error.message
    });
    if (retryCount < maxRetries) {
      logSyncOperation('error', `Exception in handleRemoteUpdate, retrying`, { 
        error: error.message, 
        attempt: retryCount + 1, 
        maxRetries: maxRetries + 1 
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
      return await handleRemoteUpdate(retryCount + 1, maxRetries);
    } else {
      console.error('Exception in handleRemoteUpdate after all retries:', error);
      logSyncOperation('error', 'Exception in handleRemoteUpdate after all retries', { 
        error: error.message 
      });
      return false;
    }
  }
}

async function addCollectionToTrack(collectionUid, windowId) {
  setTimeout(async () => {
    let { collectionsToTrack } = (await browser.storage.local.get('collectionsToTrack')) || [];
    const index = collectionsToTrack.findIndex(c => c.collectionUid === collectionUid);
    if (index !== undefined && index > -1) {
      collectionsToTrack[index].windowId = windowId;
    } else {
      collectionsToTrack.push({
        collectionUid: collectionUid,
        windowId: windowId
      });
    }
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }, 300);
}

// Performance optimization: Define patterns once outside the function
const REALTIME_DOMAINS = new Set([
  'zoom.us',
  'teams.microsoft.com', 
  'meet.google.com',
  'webex.com',
  'gotomeeting.com',
  'slack.com',
  'discord.com',
  'figma.com',
  'miro.com',
  'notion.so',
  'docs.google.com',
  'office.com',
  'office365.com'
]);

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/;
const SYSTEM_URL_PREFIXES = ['chrome-devtools://', 'chrome-extension://', 'chrome://', 'about:', 'file://'];

function shouldDiscardTab(tab) {
  // Early return for basic exclusions - most performance-critical checks first
  if (tab.pinned || tab.active) {
    return false;
  }
  
  const url = tab.url;
  
  // Check system URLs (chrome://, about:, etc.)
  if (SYSTEM_URL_PREFIXES.some(prefix => url.startsWith(prefix))) {
    return false;
  }
  
  // Check for new tab pages
  if (url.includes('://newtab')) {
    return false;
  }
  
  // Check audio state (actual media activity)
  if (tab.audible || (tab.mutedInfo && tab.mutedInfo.muted)) {
    return false;
  }
  
  // Convert to lowercase once for all domain checks
  const lowerUrl = url.toLowerCase();
  
  // Check development servers (localhost + IP addresses)
  if (lowerUrl.includes('localhost') || IPV4_PATTERN.test(lowerUrl)) {
    return false;
  }
  
  // Check real-time collaboration tools (optimized with Set lookup)
  for (const domain of REALTIME_DOMAINS) {
    if (lowerUrl.includes(domain)) {
      return false;
    }
  }
  
  // All checks passed - safe to defer this tab
  return true;
}

const isNewWindow = window => window?.tabs?.length === 1 && (!window?.tabs[0].url || window?.tabs[0].url.indexOf('://newtab') > 0);

// Helper function to check if user has enabled incognito access
async function isIncognitoEnabled() {
  try {
    // This returns true if extension is allowed in incognito mode by user
    const isAllowed = await browser.extension.isAllowedIncognitoAccess();
    return isAllowed;
  } catch (error) {
    console.warn('Could not check incognito access:', error);
    return false;
  }
}

// Optimized openTabs function for better performance with large collections
// Now with incognito-aware restoration
async function openTabs(collection, window, newWindow = null, trackOpenedWindow = true) {
  const totalTabs = collection.tabs.length;
  
  // Early return for empty collections
  if (totalTabs === 0) {
    await markCollectionOpenedBG(collection?.uid);
    return true;
  }
  
  // Check if collection was saved from incognito
  const wasFromIncognito = collection.savedFromIncognito === true;
  
  // The window is already created by the caller (frontend) - including incognito if applicable
  // We just need to detect if the passed window is incognito for proper handling
  const isIncognitoWindow = window.incognito === true;
  const incognitoRestoreAttempted = wasFromIncognito && newWindow !== null;
  const incognitoRestoreSuccess = wasFromIncognito && isIncognitoWindow;
  
  // Load settings once upfront
  const [
    { chkIgnoreDuplicates },
    { chkEnableTabDiscard }
  ] = await Promise.all([
    newWindow ?? browser.storage.local.get('chkIgnoreDuplicates'),
    browser.storage.local.get('chkEnableTabDiscard')
  ]);
  
  // Pre-filter duplicates and prepare tab data
  const currentUrlsInWindow = window.tabs ? window.tabs.map(t => t.url) : [];
  const duplicateUrls = chkIgnoreDuplicates ? new Set(currentUrlsInWindow) : new Set();
  const runtimeUrl = browser.runtime.getURL('deferedLoading.html');
  
  // URLs that cannot be opened in incognito mode
  const INCOGNITO_BLOCKED_PREFIXES = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'file://' // File URLs may be blocked depending on settings
  ];
  
  // Pre-process all tabs to avoid repeated work
  const tabsToCreate = [];
  const skippedIncognitoTabs = [];
  const firstTabUpdate = isNewWindow(window);
  
  for (let index = 0; index < totalTabs; index++) {
    const tabInGrp = collection.tabs[index];

    // Resolve the real destination URL. Collections saved by older builds (or while a
    // deferred tab was still on the placeholder page) may have persisted the
    // deferedLoading.html wrapper as the tab URL. Always open the real URL; this is also
    // what makes turning the setting off actually work for already-saved collections.
    const realUrl = unwrapDeferredUrl(tabInGrp.url);

    // Skip duplicates
    if (duplicateUrls.has(realUrl)) {
      continue;
    }

    // Skip URLs that can't be opened in incognito windows
    if (isIncognitoWindow) {
      const isBlockedUrl = INCOGNITO_BLOCKED_PREFIXES.some(prefix =>
        realUrl.toLowerCase().startsWith(prefix)
      );
      if (isBlockedUrl) {
        skippedIncognitoTabs.push({
          url: realUrl,
          title: tabInGrp.title,
          reason: 'URL type not allowed in incognito'
        });
        continue;
      }
    }

    // Pre-calculate deferred URL
    // Note: Don't use deferred loading in incognito as extension pages may have issues
    const shouldDefer = !isIncognitoWindow && chkEnableTabDiscard && shouldDiscardTab({ ...tabInGrp, url: realUrl });
    // Carry the destination in the URL hash (not the query string). Ad blockers match the
    // `?url=http...` redirect pattern and block the placeholder page (ERR_BLOCKED_BY_CLIENT);
    // a hash fragment is never sent in the request and avoids those filters.
    const finalUrl = shouldDefer
      ? `${runtimeUrl}#${encodeURIComponent(JSON.stringify({ url: realUrl, favicon: tabInGrp?.favIconUrl || '' }))}`
      : realUrl;

    tabsToCreate.push({
      originalTab: tabInGrp,
      properties: {
        pinned: tabInGrp.pinned,
        active: tabInGrp.active,
        url: finalUrl,
        windowId: window.id
      },
      updateProperties: {
        muted: tabInGrp.muted
      },
      isFirstTab: index === 0 && firstTabUpdate,
      originalIndex: index
    });
  }
  
  // Log skipped tabs if any
  if (skippedIncognitoTabs.length > 0) {
    console.warn(`Skipped ${skippedIncognitoTabs.length} tabs that cannot be opened in incognito:`, 
      skippedIncognitoTabs.map(t => t.url));
  }
  
  
  // Process tabs in optimized batches
  const BATCH_SIZE = totalTabs > 50 ? 8 : totalTabs > 20 ? 12 : 20; // Smaller batches for very large collections
  const batches = [];
  for (let i = 0; i < tabsToCreate.length; i += BATCH_SIZE) {
    batches.push(tabsToCreate.slice(i, i + BATCH_SIZE));
  }
  
  let successCount = 0;
  let errorCount = 0;
  
  // Process batches with controlled concurrency
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    // Create tabs in parallel within each batch
    const batchPromises = batch.map(async (tabData) => {
      try {
        let tab;
        
        if (tabData.isFirstTab) {
          // Update existing tab in new window (exclude windowId - not valid for update)
          const updateProps = { ...tabData.properties };
          delete updateProps.windowId;
          tab = await browser.tabs.update(window.tabs[0].id, {
            ...updateProps,
            ...tabData.updateProperties
          });
        } else {
          // Create new tab
          tab = await browser.tabs.create(tabData.properties);
          
          // Apply muted state if needed (separate call required)
          if (tabData.updateProperties.muted !== undefined) {
            try {
              await browser.tabs.update(tab.id, tabData.updateProperties);
            } catch (updateError) {
              console.warn(`Failed to apply muted state to tab ${tab.id}:`, updateError);
            }
          }
        }
        
        // Store new tab ID for group assignment
        tabData.originalTab.newTabId = tab.id;
        return { success: true, tab, originalIndex: tabData.originalIndex };
        
      } catch (error) {
        console.error(`Failed to create tab ${tabData.originalIndex + 1}/${totalTabs} (${tabData.properties.url}):`, error);
        return { success: false, error, originalIndex: tabData.originalIndex };
      }
    });
    
    // Wait for batch to complete
    const results = await Promise.allSettled(batchPromises);
    
    // Count results
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
      } else {
        errorCount++;
      }
    });
    
    
    // Small delay between batches for very large collections to prevent browser overload
    if (totalTabs > 50 && batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  // Apply chrome groups and tracking
  // Note: Tab groups are not supported in incognito windows
  try {
    if (!isIncognitoWindow) {
      const postOpenTasks = [applyChromeGroupSettings(window.id, collection)];
      if (trackOpenedWindow) {
        postOpenTasks.push(addCollectionToTrack(collection.uid, window.id));
      }
      await Promise.all(postOpenTasks);
    } else {
      if (trackOpenedWindow) {
        await addCollectionToTrack(collection.uid, window.id);
      }
      if (collection.chromeGroups && collection.chromeGroups.length > 0) {
        console.log('Note: Tab groups are not supported in incognito windows - tabs restored ungrouped');
      }
    }
  } catch (groupError) {
    console.error('Error applying chrome groups or tracking:', groupError);
  }
  
  // Authoritatively record the "recently opened" timestamp here in the background —
  // openTabs() is the single funnel for every open path (popup, fullpage, context menu,
  // keyboard command). Persisting it here (instead of in the UI) means it survives the
  // popup being torn down when a new window steals focus, and lands before the tab-load
  // auto-update can rebuild the collection, so the green "recently opened" dot is reliable.
  await markCollectionOpenedBG(collection?.uid);

  // Return detailed result object for UI feedback
  return {
    success: successCount > 0,
    tabsOpened: successCount,
    tabsFailed: errorCount,
    skippedForIncognito: skippedIncognitoTabs.length,
    wasFromIncognito: wasFromIncognito,
    restoredToIncognito: incognitoRestoreSuccess,
    incognitoAttempted: incognitoRestoreAttempted,
    isIncognitoWindow: isIncognitoWindow
  };
}

// Helper to generate UID with fallback (in case background-utils.js isn't fully loaded)
const generateUidSafe = () => {
    if (typeof generateUid === 'function') {
        return generateUid();
    }
    // Fallback implementation
    return (crypto && crypto.randomUUID) ? 
        crypto.randomUUID() : 
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
};

// Helper to apply UIDs with fallback
const applyUidSafe = (item) => {
    if (typeof applyUid === 'function') {
        return applyUid(item);
    }
    // Fallback: just return item as-is if applyUid isn't available
    // (tabs may already have UIDs from export)
    return item;
};

// Helper function to generate unique names for imports
const generateUniqueNameBG = async (originalName, type = 'collection') => {
    try {
        let existingNames = [];
        if (type === 'collection') {
            const collections = await loadAllCollectionsBG(true);
            existingNames = (collections || []).map(c => c.name);
        } else if (type === 'folder') {
            const folders = await loadAllFoldersBG();
            existingNames = (folders || []).map(f => f.name);
        }

        // If name doesn't exist, return it as-is
        if (!existingNames.includes(originalName)) {
            return originalName;
        }

        // Find the next available number
        let counter = 1;
        let newName = `${originalName} (${counter})`;
        
        while (existingNames.includes(newName)) {
            counter++;
            newName = `${originalName} (${counter})`;
        }
        
        return newName;
    } catch (error) {
        console.error('Error in generateUniqueNameBG:', error);
        // Return original name with timestamp to ensure uniqueness
        return `${originalName} (${Date.now()})`;
    }
};

// Background import handler - survives popup close
const handleImportDataBG = async (parsed) => {
    console.log('[Import] handleImportDataBG called with data type:', 
        parsed?.type || (Array.isArray(parsed) ? 'array' : (parsed?.tabs ? 'single_collection' : 'unknown')));
    
    try {
        // Verify required functions are available (from background-utils.js)
        if (typeof saveSingleCollectionBG !== 'function') {
            console.error('[Import] saveSingleCollectionBG function not found - background-utils.js may not be loaded');
            return { success: false, error: 'Import system not initialized properly. Please reload the extension.' };
        }
        
        if (!parsed) {
            return { success: false, error: 'No data provided for import' };
        }
        
        let result;
        
        // Detect import type based on structure
        if (parsed.type === 'full_export') {
            console.log('[Import] Detected full_export format');
            result = await handleFullExportImportBG(parsed);
        } else if (parsed.type === 'folder') {
            console.log('[Import] Detected folder format');
            result = await handleFolderImportBG(parsed);
        } else if (Array.isArray(parsed)) {
            console.log('[Import] Detected legacy array format with', parsed.length, 'collections');
            result = await handleLegacyCollectionsImportBG(parsed);
        } else if (parsed.tabs && Array.isArray(parsed.tabs)) {
            console.log('[Import] Detected single collection format with', parsed.tabs.length, 'tabs');
            result = await handleSingleCollectionImportBG(parsed);
        } else {
            console.log('[Import] Unknown format, keys:', Object.keys(parsed || {}));
            return { success: false, error: 'Unknown import format. Expected full_export, folder, array of collections, or single collection with tabs.' };
        }
        
        console.log('[Import] Result:', result?.success ? 'success' : 'failed', result?.error || '');
        return result;
        
    } catch (error) {
        console.error('[Import] Error in handleImportDataBG:', error);
        return { success: false, error: error?.message || String(error) || 'Unknown error occurred during import' };
    }
};

const buildImportedCollectionDescriptors = (collections = []) => (
    collections
        .filter((collection) => collection?.uid)
        .map((collection) => ({
            uid: collection.uid,
            parentId: collection.parentId || null,
        }))
);

const handleFullExportImportBG = async (exportData) => {
    try {
        let importedCollections = [];
        let importedFolders = [];

        // Import folders first
        if (exportData.folders && exportData.folders.length > 0) {
            for (const folder of exportData.folders) {
                // Generate new UID to avoid conflicts
                const newFolderUid = generateUidSafe();
                const uniqueName = await generateUniqueNameBG(folder.name, 'folder');
                const importedFolder = {
                    ...folder,
                    uid: newFolderUid,
                    name: uniqueName,
                    lastUpdated: Date.now()
                };
                
                await saveSingleFolderBG(importedFolder);
                importedFolders.push(importedFolder);
                
                // Update collections that belong to this folder
                if (exportData.collections) {
                    exportData.collections.forEach(collection => {
                        if (collection.parentId === folder.uid) {
                            collection.parentId = newFolderUid;
                        }
                    });
                }
            }
        }

        // Import collections
        if (exportData.collections && exportData.collections.length > 0) {
            for (const collection of exportData.collections) {
                // Generate new UID to avoid conflicts
                const newCollectionUid = generateUidSafe();
                const uniqueName = await generateUniqueNameBG(collection.name, 'collection');
                // Build clean collection object
                let importedCollection = {
                    uid: newCollectionUid,
                    name: uniqueName,
                    tabs: collection.tabs || [],
                    chromeGroups: collection.chromeGroups || [],
                    color: collection.color || 'default',
                    createdOn: Date.now(),
                    lastUpdated: Date.now(),
                    lastOpened: null,
                    parentId: collection.parentId || null,
                    order: collection.order
                };

                // Apply UIDs to tabs if needed
                if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                    importedCollection = applyUidSafe(importedCollection);
                }

                await saveSingleCollectionBG(importedCollection);
                importedCollections.push(importedCollection);
            }
        }

        // Sync legacy storage for backwards compatibility
        await forceLegacyStorageSync();
        
        // Also update the legacy tabsArray directly
        const allCollections = await loadAllCollectionsBG(true);
        console.log('[Import] Total collections after full export import:', allCollections?.length);
        await browser.storage.local.set({ 
            tabsArray: allCollections,
            localTimestamp: Date.now()
        });

        return {
            success: true,
            foldersImported: importedFolders.length,
            collectionsImported: importedCollections.length,
            importedCollections: buildImportedCollectionDescriptors(importedCollections),
            firstCollectionUid: importedCollections.length > 0 ? importedCollections[0].uid : null,
            message: `Successfully imported ${importedFolders.length} folders and ${importedCollections.length} collections`
        };
    } catch (error) {
        console.error('Error importing full export:', error);
        return { success: false, error: error?.message || String(error) };
    }
};

const handleFolderImportBG = async (folderData) => {
    try {
        // Import the folder with new UID
        const newFolderUid = generateUidSafe();
        const uniqueFolderName = await generateUniqueNameBG(folderData.folder.name, 'folder');
        const importedFolder = {
            ...folderData.folder,
            uid: newFolderUid,
            name: uniqueFolderName,
            lastUpdated: Date.now()
        };
        
        await saveSingleFolderBG(importedFolder);

        // Import collections in the folder
        let importedCollections = [];
        if (folderData.collections && folderData.collections.length > 0) {
            for (const collection of folderData.collections) {
                const newCollectionUid = generateUidSafe();
                const uniqueCollectionName = await generateUniqueNameBG(collection.name, 'collection');
                // Build clean collection object
                let importedCollection = {
                    uid: newCollectionUid,
                    name: uniqueCollectionName,
                    tabs: collection.tabs || [],
                    chromeGroups: collection.chromeGroups || [],
                    color: collection.color || 'default',
                    createdOn: Date.now(),
                    lastUpdated: Date.now(),
                    lastOpened: null,
                    parentId: newFolderUid,
                    order: collection.order
                };

                if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                    importedCollection = applyUidSafe(importedCollection);
                }

                await saveSingleCollectionBG(importedCollection);
                importedCollections.push(importedCollection);
            }
        }

        // Sync legacy storage for backwards compatibility
        await forceLegacyStorageSync();
        
        // Also update the legacy tabsArray directly
        const allCollections = await loadAllCollectionsBG(true);
        console.log('[Import] Total collections after folder import:', allCollections?.length);
        await browser.storage.local.set({ 
            tabsArray: allCollections,
            localTimestamp: Date.now()
        });

        return {
            success: true,
            foldersImported: 1,
            collectionsImported: importedCollections.length,
            importedCollections: buildImportedCollectionDescriptors(importedCollections),
            firstCollectionUid: importedCollections.length > 0 ? importedCollections[0].uid : null,
            message: `Successfully imported folder "${importedFolder.name}" with ${importedCollections.length} collections`
        };
    } catch (error) {
        console.error('Error importing folder:', error);
        return { success: false, error: error?.message || String(error) };
    }
};

const handleLegacyCollectionsImportBG = async (collections) => {
    try {
        // Legacy array of collections import - apply unique names
        const importedCollections = [];
        for (const collection of collections) {
            const uniqueName = await generateUniqueNameBG(collection.name, 'collection');
            const newCollectionUid = generateUidSafe();
            // Build clean collection object
            let importedCollection = {
                uid: newCollectionUid,
                name: uniqueName,
                tabs: collection.tabs || [],
                chromeGroups: collection.chromeGroups || [],
                color: collection.color || 'default',
                createdOn: Date.now(),
                lastUpdated: Date.now(),
                lastOpened: null,
                parentId: null,
                order: collection.order
            };
            
            // Apply UIDs to tabs if needed
            if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                importedCollection = applyUidSafe(importedCollection);
            }
            
            await saveSingleCollectionBG(importedCollection);
            importedCollections.push(importedCollection);
        }
        
        // Sync legacy storage for backwards compatibility
        await forceLegacyStorageSync();
        
        // Also update the legacy tabsArray directly
        const allCollections = await loadAllCollectionsBG(true);
        await browser.storage.local.set({ 
            tabsArray: allCollections,
            localTimestamp: Date.now()
        });
        
        return {
            success: true,
            foldersImported: 0,
            collectionsImported: importedCollections.length,
            importedCollections: buildImportedCollectionDescriptors(importedCollections),
            firstCollectionUid: importedCollections.length > 0 ? importedCollections[0].uid : null,
            message: `Successfully imported ${importedCollections.length} collections`
        };
    } catch (error) {
        console.error('Error importing legacy collections:', error);
        return { success: false, error: error?.message || String(error) };
    }
};

const handleSingleCollectionImportBG = async (collection) => {
    try {
        console.log('[Import] handleSingleCollectionImportBG - starting import for:', collection?.name);
        
        if (!collection || !collection.name) {
            return { success: false, error: 'Invalid collection data: missing name' };
        }
        
        // Legacy single collection import with unique name
        const uniqueName = await generateUniqueNameBG(collection.name, 'collection');
        console.log('[Import] Generated unique name:', uniqueName);
        
        // Always generate a new UID to avoid conflicts with existing collections
        const newCollectionUid = generateUidSafe();
        console.log('[Import] Generated new UID:', newCollectionUid);
        
        // Build clean collection object - only include the properties we need
        // Exclude 'window' and other runtime properties that shouldn't be persisted
        let importedCollection = {
            uid: newCollectionUid,
            name: uniqueName,
            tabs: collection.tabs || [],
            chromeGroups: collection.chromeGroups || [],
            color: collection.color || 'default',
            createdOn: Date.now(),
            lastUpdated: Date.now(),
            lastOpened: null,
            parentId: null,
            order: collection.order
        };
        
        // Apply UIDs to tabs if needed
        if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
            console.log('[Import] Applying UIDs to tabs');
            importedCollection = applyUidSafe(importedCollection);
        }
        
        console.log('[Import] Saving collection with', importedCollection.tabs?.length || 0, 'tabs');
        console.log('[Import] Collection data:', JSON.stringify({
            uid: importedCollection.uid,
            name: importedCollection.name,
            tabCount: importedCollection.tabs?.length,
            color: importedCollection.color
        }));
        
        const saveResult = await saveSingleCollectionBG(importedCollection);
        console.log('[Import] Save result:', saveResult);
        
        if (!saveResult) {
            return { success: false, error: 'Failed to save collection to storage' };
        }
        
        // Verify the save worked by trying to load the collection back
        const verifyCollection = await loadSingleCollectionBG(newCollectionUid);
        console.log('[Import] Verification - collection exists in storage:', !!verifyCollection);
        if (!verifyCollection) {
            return { success: false, error: 'Collection was saved but could not be verified in storage' };
        }
        
        // Sync legacy storage for backwards compatibility
        console.log('[Import] Syncing legacy storage');
        await forceLegacyStorageSync();
        
        // Also update the legacy tabsArray directly to ensure it's there
        const allCollections = await loadAllCollectionsBG(true);
        console.log('[Import] Total collections after import:', allCollections?.length);
        await browser.storage.local.set({ 
            tabsArray: allCollections,
            localTimestamp: Date.now()
        });
        
        console.log('[Import] Import completed successfully');
        return {
            success: true,
            foldersImported: 0,
            collectionsImported: 1,
            importedCollections: buildImportedCollectionDescriptors([importedCollection]),
            firstCollectionUid: importedCollection.uid,
            message: `Successfully imported collection "${importedCollection.name}"`
        };
    } catch (error) {
        console.error('[Import] Error importing single collection:', error);
        return { success: false, error: error?.message || String(error) || 'Failed to import collection' };
    }
};

try {
  browser.runtime.onMessage.addListener(async (request) => {
    if (request.type === 'checkSyncStatus') {
      try {
        const {
          googleUser,
          googleRefreshToken,
          syncAuthError
        } = await browser.storage.local.get(['googleUser', 'googleRefreshToken', 'syncAuthError']);

        if (!googleRefreshToken && !googleUser) {
          logSyncOperation('info', 'No Google credentials found for sync status check');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.DISABLED,
            isEnabled: false,
            hasRefreshToken: false,
            user: null,
            error: null
          });
          return Promise.resolve(false);
        }

        if (!googleUser && googleRefreshToken) {
          logSyncOperation('info', 'Refresh token available but profile missing, reporting reconnecting state');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.AUTH_REFRESHING,
            hasRefreshToken: true,
            user: null,
            error: null
          });
          return Promise.resolve({
            syncStatus: 'auth_refreshing',
            hasRefreshToken: true
          });
        }
        
        // Check if there's a persistent auth error that requires user action.
        // A stored error can go stale: a dev build with missing credentials, or a
        // transient failure that has since recovered, would otherwise lock the user
        // out forever because this early return runs before the token is ever
        // re-validated (and before the clear at the bottom of this handler). So when a
        // refresh token is still present, try to obtain a token first — if that works
        // the stored error is stale and we clear it and continue normally.
        if (syncAuthError && syncAuthError.type) {
          const recoveryToken = googleRefreshToken ? await getAuthToken() : false;
          if (recoveryToken === false) {
            logSyncOperation('info', 'Auth error detected, user needs to re-authenticate', {
              errorType: syncAuthError.type,
              age: Date.now() - syncAuthError.timestamp
            });
            await updateSharedSyncSessionState({
              status: SYNC_SESSION_STATUS.AUTH_REQUIRED,
              error: syncAuthError.message || 'Please sign out and sign back in to restore sync.'
            });
            return Promise.resolve({
              ...googleUser,
              syncStatus: 'auth_required',
              syncError: syncAuthError.message || 'Please sign out and sign back in to restore sync.'
            });
          }
          logSyncOperation('info', 'Cleared stale sync auth error after recovering a valid token', {
            errorType: syncAuthError.type,
            age: Date.now() - syncAuthError.timestamp
          });
          await browser.storage.local.remove('syncAuthError');
        }

        // Try to get auth token with improved error handling
        const token = await getAuthToken();
        if (token === false) {
          // Check if we have a refresh token - if so, this might be recoverable
          if (googleRefreshToken) {
            logSyncOperation('info', 'Auth token failed but refresh token available, sync may recover automatically');
            // Return user info so UI doesn't completely disable sync
            await updateSharedSyncSessionState({
              status: SYNC_SESSION_STATUS.AUTH_REFRESHING,
              hasRefreshToken: true,
              error: null
            });
            return Promise.resolve({ ...googleUser, syncStatus: 'auth_refreshing' });
          } else {
            logSyncOperation('error', 'No auth token and no refresh token available - user must re-authenticate');
            await updateSharedSyncSessionState({
              status: SYNC_SESSION_STATUS.AUTH_REQUIRED,
              isEnabled: false,
              hasRefreshToken: false,
              error: 'Your sync session has expired. Please sign out and sign back in.'
            });
            return Promise.resolve({ 
              ...googleUser, 
              syncStatus: 'auth_required',
              syncError: 'Your sync session has expired. Please sign out and sign back in.'
            });
          }
        }
        
        // Clear any previous auth error since we got a valid token
        if (syncAuthError) {
          await browser.storage.local.remove('syncAuthError');
        }
        await updateSharedSyncSessionState({
          status: SYNC_SESSION_STATUS.SYNCING,
          error: null
        });
        
        // Try to verify sync file exists/create it
        const syncFileSuccess = await getOrCreateSyncFile(token);
        if (syncFileSuccess === false) {
          logSyncOperation('error', 'Failed to get or create sync file');
          // Don't return false immediately - sync might still work
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.SYNC_FILE_ERROR
          });
          return Promise.resolve({ ...googleUser, syncStatus: 'sync_file_error' });
        }
        
        // Get updated user info to confirm everything is working
        const user = await getGoogleUser(token);
        if (!user) {
          logSyncOperation('error', 'Failed to get user info');
          // Return cached user info with error status
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.USER_INFO_ERROR
          });
          return Promise.resolve({ ...googleUser, syncStatus: 'user_info_error' });
        }
        
        logSyncOperation('success', 'Sync status check completed successfully');
        await updateSharedSyncSessionState({
          status: SYNC_SESSION_STATUS.ACTIVE,
          user,
          hasRefreshToken: true,
          error: null
        });
        await ensureBackgroundSyncAlarm();
        return Promise.resolve({ ...user, syncStatus: 'active' });
        
      } catch (error) {
        logSyncOperation('error', 'Exception in checkSyncStatus', { error: error.message });
        // Return cached user info if available
        const { googleUser, googleRefreshToken } = await browser.storage.local.get(['googleUser', 'googleRefreshToken']);
        await updateSharedSyncSessionState({
          status: googleRefreshToken ? SYNC_SESSION_STATUS.ERROR : SYNC_SESSION_STATUS.DISABLED,
          hasRefreshToken: Boolean(googleRefreshToken),
          error: error.message || 'Unknown sync error'
        });
        if (googleUser) {
          return Promise.resolve({ ...googleUser, syncStatus: 'error' });
        }
        return Promise.resolve(false);
      }
    }
    
    // New debug and recovery handlers
    if (request.type === 'getSyncLogs') {
      try {
        const { syncLogs = [] } = await browser.storage.local.get('syncLogs');
        return Promise.resolve(syncLogs);
      } catch (error) {
        console.error('Error getting sync logs:', error);
        return Promise.resolve([]);
      }
    }
    
    if (request.type === 'getBackupOptions') {
      try {
        const { preSyncBackups = [], autoBackups = [], backup } = await browser.storage.local.get(['preSyncBackups', 'autoBackups', 'backup']);
        return Promise.resolve({
          groups: buildGroupedBackupOptions({ preSyncBackups, autoBackups, backup }),
          preSyncBackups,
          autoBackups,
          versionBackup: backup
        });
      } catch (error) {
        console.error('Error getting backup options:', error);
        return Promise.resolve({ groups: [], preSyncBackups: [], autoBackups: [], versionBackup: null });
      }
    }

    if (request.type === 'getBackupPreview') {
      try {
        return Promise.resolve(await buildBackupPreviewResponse(request.backupId));
      } catch (error) {
        console.error('Error getting backup preview:', error);
        return Promise.resolve(undefined);
      }
    }

    if (request.type === 'restoreBackupSelection') {
      try {
        if (request.mode === 'overwrite') {
          return Promise.resolve(await overwriteBackupSelection(request.payload));
        }

        return Promise.resolve(await handleImportDataBG(request.payload));
      } catch (error) {
        console.error('Error restoring backup selection:', error);
        return Promise.resolve({
          success: false,
          error: error?.message || 'Restore failed'
        });
      }
    }
    
    if (request.type === 'recoverFromBackup') {
      try {
        const { backupType, backupIndex } = request;
        let backupData = null;
        
        if (backupType === 'preSync') {
          const { preSyncBackups = [] } = await browser.storage.local.get('preSyncBackups');
          if (preSyncBackups[backupIndex]) {
            backupData = preSyncBackups[backupIndex];
          }
        } else if (backupType === 'auto') {
          const { autoBackups = [] } = await browser.storage.local.get('autoBackups');
          if (autoBackups[backupIndex]) {
            backupData = autoBackups[backupIndex];
          }
        } else if (backupType === 'version') {
          const { backup } = await browser.storage.local.get('backup');
          backupData = backup;
        }
        
        if (backupData && backupData.tabsArray) {
          // Pre-sync (and other metadata-only) backups store just tabCount + sampleTabs,
          // never the full `tabs`. Restoring one would overwrite live collections with
          // empty tabs, wiping real data. Refuse anything that isn't a full snapshot.
          if (!isFullCollectionSnapshot(backupData)) {
            console.warn('[Recovery] Refusing to restore a metadata-only backup (no full tabs)');
            return Promise.resolve(false);
          }

          // Restore the FULL backup state, not just collections. Use the same overwrite
          // path as the recovery panel so folders are restored, collection parentIds are
          // normalized, and folders absent from the backup are pruned (their orphaned
          // collections fall back to root). Writing collections alone left folder layout
          // stale, so a restore appeared to "do nothing".
          const restoreResult = await overwriteBackupSelection({
            type: 'full_export',
            collections: backupData.tabsArray,
            folders: Array.isArray(backupData.foldersArray) ? backupData.foldersArray : [],
            pruneMissingFolders: true
          });
          await browser.storage.local.set({
            localTimestamp: Date.now() // Mark as newly updated
          });
          return Promise.resolve(Boolean(restoreResult?.success));
        }
        
        return Promise.resolve(false);
      } catch (error) {
        console.error('Error recovering from backup:', error);
        return Promise.resolve(false);
      }
    }
    
    if (request.type === 'forceSyncReset') {
      try {
        // Clear sync state and force re-sync
        await browser.storage.sync.remove('syncFileId');
        await browser.storage.local.remove(['googleToken', 'localTimestamp']);
        
        const { googleUser } = await browser.storage.local.get('googleUser');
        if (googleUser) {
          // Re-establish sync
          const token = await getAuthToken();
          if (token !== false) {
            await getOrCreateSyncFile(token);
            await syncData(token);
          }
        }
        
        return Promise.resolve(true);
      } catch (error) {
        console.error('Error during sync reset:', error);
        return Promise.resolve(false);
      }
    }

    if (request.type === 'login') {
      try {
        const redirectUrl = await browser.identity.launchWebAuthFlow({
          'url': createAuthEndpoint(),
          'interactive': true
        });
        const url = new URL(redirectUrl);
        const urlParams = url.searchParams;
        const params = Object.fromEntries(urlParams.entries());
        
        const token = await getTokens(params.code);
        if (token === false) {
          console.error('Failed to get tokens during login');
          return Promise.resolve(false);
        }
        
        // Clear any previous auth errors since we got new tokens
        await browser.storage.local.remove('syncAuthError');
        
        const syncFileResult = await getOrCreateSyncFile(token);
        if (syncFileResult === false) {
          console.error('Failed to create/find sync file during login');
          return Promise.resolve(false);
        }
        
        const user = await getGoogleUser(token);
        if (!user) {
          console.error('Failed to get user info during login');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.USER_INFO_ERROR,
            hasRefreshToken: true
          });
          return Promise.resolve(false);
        }

        await updateSharedSyncSessionState({
          status: SYNC_SESSION_STATUS.SYNCING,
          user,
          hasRefreshToken: true,
          error: null
        });
        
        // 🛡️ SAFETY: Check local data state before initial sync
        // For new devices (empty local data), we should prioritize downloading from server
        const localCollections = await loadAllCollectionsBG(true);
        const localCollectionCount = localCollections ? localCollections.length : 0;
        
        logSyncOperation('info', 'Login successful - starting initial sync', {
          localCollectionCount,
          isNewDevice: localCollectionCount === 0
        });
        
        const syncResult = await syncData(token);
        if (syncResult === false) {
          console.error('Initial sync failed during login');
          // Still return user as login was successful, sync can be retried
          logSyncOperation('error', 'Initial sync failed during login - user can retry manually');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.ERROR,
            user,
            hasRefreshToken: true
          });
        } else if (syncResult === 'already_in_progress') {
          logSyncOperation('info', 'Sync already in progress during login, will complete separately');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.SYNCING,
            user,
            hasRefreshToken: true
          });
        } else {
          logSyncOperation('success', 'Initial sync completed successfully during login');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.ACTIVE,
            user,
            hasRefreshToken: true,
            error: null
          });
        }

        await ensureBackgroundSyncAlarm();
        
        return Promise.resolve(user);
      } catch (error) {
        console.error('Exception during login:', error);
        return Promise.resolve(false);
      }
    }
    if (request.type === 'openTabs') {
      const result = await openTabs(
        request.collection,
        request.window,
        request.newWindow,
        request.trackOpenedWindow !== false
      );
      // Return the detailed result object for UI feedback
      return Promise.resolve(result);
    }
    
    // Check if incognito access is enabled for user feedback
    if (request.type === 'checkIncognitoAccess') {
      try {
        const isAllowed = await browser.extension.isAllowedIncognitoAccess();
        return Promise.resolve({ 
          allowed: isAllowed,
          message: isAllowed 
            ? 'Incognito access is enabled' 
            : 'Enable "Allow in incognito" in extension settings to restore incognito collections to incognito windows'
        });
      } catch (error) {
        return Promise.resolve({ allowed: false, error: error.message });
      }
    }

    if (request.type === 'updateBadge') {
      await handleBadge();
      return Promise.resolve(true);
    }

    if (request.type === 'updateRemote') {
      console.log('🔄 [SYNC] updateRemote message received - starting sync');
      try {
        // Coalesce overlapping syncs; a request made during an in-flight sync
        // awaits a trailing run that pushes the latest local state.
        const result = await throttleSync(() => handleRemoteUpdate());
        if (result === false) {
          console.log('🔄 [SYNC] updateRemote FAILED');
          logSyncOperation('error', 'Remote update failed');
        } else {
          console.log('🔄 [SYNC] updateRemote SUCCESS');
        }
        // Success is already logged by handleRemoteUpdate(), no need to log again
        return Promise.resolve(result);
      } catch (error) {
        console.log('🔄 [SYNC] updateRemote EXCEPTION:', error.message);
        logSyncOperation('error', 'Exception in updateRemote', { error: error.message });
        console.error('Exception in updateRemote:', error);
        return Promise.resolve(false);
      }
    }

    if (request.type === 'loadFromServer') {
      console.log('🔄 [SYNC] loadFromServer message received');
      try {
        const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
        if (!googleRefreshToken) {
          console.log('🔄 [SYNC] loadFromServer: No refresh token');
          logSyncOperation('error', 'No refresh token available for loadFromServer');
          return Promise.resolve(false);
        }

        await updateSharedSyncSessionState({
          status: SYNC_SESSION_STATUS.SYNCING,
          error: null
        });
        
        // Try to get auth token with retries
        let token = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          token = await getAuthToken();
          if (token !== false) break;
          
          if (attempt < 2) {
            logSyncOperation('info', `Auth token failed for loadFromServer, retrying`, { 
              attempt: attempt + 1, 
              maxRetries: 3 
            });
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
        
        if (token === false) {
          logSyncOperation('error', 'Failed to get auth token after all retries for loadFromServer');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.AUTH_REFRESHING
          });
          return Promise.resolve(false);
        }
        
        const newData = await updateLocalDataFromServer(token, request.force);
        console.log('🔄 [SYNC] loadFromServer result:', newData === false ? 'FAILED' : (newData === 'no_update_needed' ? 'NO_UPDATE_NEEDED' : `SUCCESS (${newData?.length || 0} collections)`));
        if (newData === false) {
          logSyncOperation('error', 'Server load failed - NOT pushing local data as fallback to prevent data loss');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.ERROR
          });
        } else if (newData === 'no_update_needed') {
          // No update needed - data is already in sync
          logSyncOperation('info', 'Local data is already in sync, no action needed');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.ACTIVE,
            error: null
          });
        } else if (newData === 'already_in_progress') {
          // Operation already in progress, no need for fallback
          logSyncOperation('info', 'Server load already in progress');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.SYNCING
          });
        } else {
          // Successfully loaded new data from server
          logSyncOperation('success', 'Successfully loaded data from server');
          await updateSharedSyncSessionState({
            status: SYNC_SESSION_STATUS.ACTIVE,
            error: null
          });
        }
        
        return Promise.resolve(newData);
      } catch (error) {
        logSyncOperation('error', 'Exception in loadFromServer', { error: error.message });
        console.error('Exception in loadFromServer:', error);
        await updateSharedSyncSessionState({
          status: SYNC_SESSION_STATUS.ERROR,
          error: error.message
        });
        return Promise.resolve(false);
      }
    }

    if (request.type === 'logout') {
      const token = await getAuthToken();
      await browser.alarms.clear(BACKGROUND_SYNC_ALARM);
      if (token === false) {
        await browser.storage.local.remove(['googleUser', 'googleToken', 'googleRefreshToken', 'tokenExpiryTime', 'syncAuthError']);
        await updateSharedSyncSessionState({
          status: SYNC_SESSION_STATUS.DISABLED,
          isEnabled: false,
          hasRefreshToken: false,
          user: null,
          error: null
        });
        await browser.storage.sync.remove('syncFileId');
        return Promise.resolve(true);
      }
      await browser.storage.local.remove(['googleUser', 'googleToken', 'googleRefreshToken', 'tokenExpiryTime', 'syncAuthError']);
      await updateSharedSyncSessionState({
        status: SYNC_SESSION_STATUS.DISABLED,
        isEnabled: false,
        hasRefreshToken: false,
        user: null,
        error: null
      });
      await browser.storage.sync.remove('syncFileId');
      return Promise.resolve(true);
    }

    if (request.type === 'focusWindow') {
      try {
        await browser.windows.update(request.windowId, { focused: true });
        return Promise.resolve(true);
      } catch {
        // Clean up tracking for this window
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        if (collectionsToTrack && collectionsToTrack.length > 0) {
          const updatedTracking = collectionsToTrack.filter(c => c.windowId !== request.windowId);
          await browser.storage.local.set({ collectionsToTrack: updatedTracking });
        }
        return Promise.resolve(false);
      }
    }

    if (request.type === 'addCollection') {
      await handleContextMenuCreation();
      return Promise.resolve(true);
    }
    
    if (request.type === 'cleanupBackups') {
      try {
        const result = await cleanupLargeBackups();
        return Promise.resolve(result !== undefined);
      } catch (error) {
        console.error('Error in cleanupBackups message handler:', error);
        return Promise.resolve(false);
      }
    }

    // Import data handler - runs in background to survive popup close
    if (request.type === 'importData') {
      console.log('[Import] Received importData message');
      try {
        const result = await handleImportDataBG(request.data);
        console.log('[Import] Handler completed, result:', JSON.stringify(result).substring(0, 200));
        // Ensure we always return a valid result object
        if (!result) {
          return Promise.resolve({ success: false, error: 'Import handler returned no result' });
        }
        return Promise.resolve(result);
      } catch (error) {
        console.error('[Import] Error in importData message handler:', error);
        return Promise.resolve({
          success: false,
          error: error?.message || String(error) || 'Unknown error in import message handler'
        });
      }
    }

    if (request.type === 'smartOrganizeApply') {
      const result = await applySmartOrganizePlan({
        windowId: request.windowId,
        plan: request.plan,
        createdAt: request.createdAt,
      });
      return Promise.resolve(result);
    }

    if (request.type === 'smartOrganizeUndo') {
      const result = await undoSmartOrganize({ windowId: request.windowId });
      return Promise.resolve(result);
    }

    if (request.type === 'aiRun' || request.type === 'aiUndo') {
      // Build the engine + ctx HERE so SW-native deps are in scope (throttleSync /
      // handleRemoteUpdate / loadAllCollectionsBG are background.js lexical bindings,
      // not module-load globals).
      const engine = globalThis.TaboxAIEngine.createEngine({
        registry: globalThis.TaboxAIRegistry,
        ctx: {
          client: globalThis.TaboxAIClient,
          planners: globalThis.TaboxAIPlanners,
          storage: globalThis.TaboxAIStorage,
          loadCollections: () => loadAllCollectionsBG(true),
          loadLooseSummaries: () => loadLooseCollectionSummariesBG(
            (globalThis.TaboxAIPlanners && globalThis.TaboxAIPlanners.MAX_TITLES_PER_COLLECTION) || 5
          ),
          readWindow: (windowId) => readWindowForAI(windowId),
          triggerSync: () => throttleSync(() => handleRemoteUpdate()),
        },
      });
      if (request.type === 'aiUndo') {
        try {
          await engine.undoLast();
          return Promise.resolve({ ok: true });
        } catch (error) {
          console.error('Tabox AI: aiUndo failed:', error);
          return Promise.resolve({ ok: false, error: error?.message || String(error) });
        }
      }
      const controller = new AbortController();
      globalThis.__aiAbort = controller; // single in-flight AI task
      let result;
      try {
        result = await engine.runTask({ id: request.task, params: request.params || {}, signal: controller.signal });
      } finally { globalThis.__aiAbort = null; }
      return Promise.resolve(result); // engine maps throw/abort to status:error/cancelled
    }
    if (request.type === 'aiCancel') {
      if (globalThis.__aiAbort) globalThis.__aiAbort.abort();
      const cur = (await browser.storage.local.get('aiTaskState')).aiTaskState || {};
      await browser.storage.local.set({ aiTaskState: { ...cur, cancelRequested: true } });
      return Promise.resolve({ ok: true });
    }
    if (request.type === 'aiWarmup') {
      // Fire-and-forget model warm-up: creating then destroying a session loads the
      // model weights into memory so the first real AI task's session-create + first
      // decode are faster. The warm cost persists past destroy(). Errors (model not
      // downloaded / unavailable) are swallowed — there's simply nothing to warm.
      try {
        const warmSession = await globalThis.TaboxAIClient.createAISession({});
        warmSession.destroy();
      } catch (warmError) {
        console.error('Tabox AI: warmup skipped:', warmError && warmError.message);
      }
      return Promise.resolve({ ok: true });
    }
    if (request.type === 'aiGetState') {
      return Promise.resolve((await browser.storage.local.get('aiTaskState')).aiTaskState || null);
    }

  });
  browser.commands.onCommand.addListener(async (command) => {
    try {
      const index = parseInt(command.replace('open-collection-', '')) - 1;
      // 🚀 NEW: Load from indexed storage
      const tabsArray = await loadAllCollectionsBG(true);
      if (!tabsArray || tabsArray.length === 0 || index > tabsArray.length - 1) return;
      
      const collection = tabsArray[index];
      let window;
      const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
      
      // Check if collection was from incognito and if we should try incognito window
      const wasFromIncognito = collection.savedFromIncognito === true;
      let createIncognito = false;
      
      if (wasFromIncognito && chkOpenNewWindow) {
        const incognitoAllowed = await isIncognitoEnabled();
        createIncognito = incognitoAllowed;
      }
      
      if (chkOpenNewWindow) {
        window = await browser.windows.create({ 
          focused: true,
          incognito: createIncognito 
        });
      } else {
        window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
      }
      
      window.tabs = await browser.tabs.query({ windowId: window.id });
      const result = await openTabs(collection, window, chkOpenNewWindow);
      
      // Log result for debugging
      if (result && typeof result === 'object') {
        if (result.wasFromIncognito && !result.restoredToIncognito) {
          console.log('Note: Collection was from incognito but restored to normal window');
        }
        if (result.skippedForIncognito > 0) {
          console.log(`Note: ${result.skippedForIncognito} tabs skipped (not allowed in incognito)`);
        }
      }
    } catch (error) {
      console.error('Error in keyboard shortcut handler:', error);
    }
  });

  browser.action.onClicked.addListener(async () => {
    try {
      const { [TOOLBAR_FULLPAGE_SETTING_KEY]: openInFullPage } = await browser.storage.local.get(TOOLBAR_FULLPAGE_SETTING_KEY);
      if (openInFullPage) {
        await openExtensionFullPage();
      }
    } catch (error) {
      console.error('Error handling toolbar action click:', error);
    }
  });

  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local' || !changes[TOOLBAR_FULLPAGE_SETTING_KEY]) {
      return;
    }

    try {
      await applyToolbarLaunchBehavior();
    } catch (error) {
      console.error('Error applying toolbar launch behavior:', error);
    }
  });

  const handleMenuClick = async (info, tab) => {
    if (info.menuItemId === 'tabox-super') return;
    let tabsArray = await loadAllCollectionsBG(true);
    let tabToAdd = { ...tab };
    const isClickOnTabGroup = info?.menuItemId?.includes('-main');
    const collectionUid = isClickOnTabGroup ? info?.parentMenuItemId?.replace('-main', '') : info.menuItemId;
    const collectionIndex = tabsArray.findIndex(c => c.uid === collectionUid);
    if (collectionIndex === -1) return;
    if (isClickOnTabGroup) {
      const groupUid = info.menuItemId.split('|')[1];
      const group = tabsArray[collectionIndex].chromeGroups?.find(cg => cg.uid === groupUid);
      if (!group) return;
      const indexInTabs = tabsArray[collectionIndex].tabs.findIndex(t => t.groupUid === group.uid);
      tabToAdd.groupId = group.id;
      tabToAdd.groupUid = group.uid;
      tabsArray[collectionIndex]?.tabs?.splice(indexInTabs, 0, tabToAdd);
    } else {
      tabsArray[collectionIndex]?.tabs?.push(tabToAdd);
    }

    await saveSingleCollectionBG(tabsArray[collectionIndex], true);
    syncLegacyStorageThrottled();
    await handleRemoteUpdate();
  }

  browser.contextMenus.onClicked.addListener(handleMenuClick);

  const handleAutoBackupAlarm = async () => {
    const alarms = await browser.alarms.getAll();
    const hasAlarm = alarms.some(a => a.name === AUTO_BACKUP_ALARM);
    if (hasAlarm) {
      await browser.alarms.clear(AUTO_BACKUP_ALARM);
    }
    // Create backup alarm - runs every 60 minutes (1 hour) instead of every 6 seconds
    // This prevents excessive CPU usage while idle
    browser.alarms.create(AUTO_BACKUP_ALARM, {
      delayInMinutes: 1, // Start after 1 minute
      periodInMinutes: 60 // Run every 60 minutes (1 hour)
    })
  }

  browser.runtime.onInstalled.addListener(async (details) => {
    const previousVersion = details.previousVersion;
    const currentVersion = chrome.runtime.getManifest().version;
    const reason = details.reason;
    
    // Handle migration for updates
    if (reason === "update") {
      
      // Only set update flag if version actually changed
      if (previousVersion !== currentVersion) {
        
        // Create version backup (existing behavior)
        // 🚀 NEW: Load from indexed storage
        let tabsArray = await loadAllCollectionsBG(true);
        const foldersArray = await loadAllFoldersBG();
        if (tabsArray && tabsArray.length > 0) {
          tabsArray = updateCollectionsUids(tabsArray);
          const backupObj = {
            version: previousVersion,
            tabsArray: tabsArray,
            foldersArray,
            timestamp: Date.now()
          }
          await browser.storage.local.set({ backup: backupObj });
        }
        
        // Migration will be handled by the main app on next startup
        // This ensures migrations run in the proper context with full access to utilities
        
        // Set a flag to indicate an update occurred
        await browser.storage.local.set({ 
          extensionUpdated: true,
          updateTimestamp: Date.now(),
          previousVersion: previousVersion,
          currentVersion: currentVersion
        });
      }
    } else if (reason === "install") {
      // Mark as fresh install - no migration needed
      await browser.storage.local.set({ 
        extensionInstalled: true,
        installTimestamp: Date.now(),
        installedVersion: currentVersion
      });
    }
    
      await setInitialOptions();
  await applyToolbarLaunchBehavior();
  await handleContextMenuCreation();
  await handleBadge();
  await handleAutoBackupAlarm();
  await ensureBackgroundSyncAlarm();
  
  // Clean up large backups on startup (after 5 seconds to not block initialization)
  setTimeout(async () => {
    try {
      await cleanupLargeBackups();
    } catch (error) {
      console.error('Error during startup backup cleanup:', error);
    }
  }, 5000);
  })

  browser.runtime.onStartup.addListener(async () => {
    await setInitialOptions();
    await applyToolbarLaunchBehavior();
    await handleAutoBackupAlarm();
    await ensureBackgroundSyncAlarm();
  });

  const handleAutoBackup = async () => {
    // Early exit: Check if backup is needed before expensive operations
    const { autoBackups, localTimestamp } = await browser.storage.local.get(['autoBackups', 'localTimestamp']);
    
    // Skip if no data changes since last backup
    if (autoBackups && autoBackups.length > 0 && autoBackups[0].timestamp === localTimestamp) {
      return; // No changes detected, skip backup
    }
    
    // 🚀 NEW: Load from indexed storage only when backup is actually needed
    const [tabsArray, foldersArray] = await Promise.all([
      loadAllCollectionsBG(true),
      loadAllFoldersBG()
    ]);
    
    if (!tabsArray || tabsArray.length === 0) {
      return; // No collections to backup
    }
    
    const finalAutoBackups = autoBackups || [];
    const backupObj = {
      timestamp: localTimestamp || Date.now(),
      tabsArray,
      foldersArray
    }
    finalAutoBackups.unshift(backupObj);
    
    // Aggressive auto-backup limits to save storage and memory
    const MAX_AUTO_BACKUPS = 2; // Reduced from 3 for memory optimization
    const MAX_AUTO_BACKUP_SIZE = 1.5 * 1024 * 1024; // 1.5MB limit
    
    if (finalAutoBackups.length > MAX_AUTO_BACKUPS) {
      finalAutoBackups.splice(MAX_AUTO_BACKUPS); // More efficient than slice for truncation
    }
    
    // Check size and remove oldest if needed
    let totalSize = finalAutoBackups.reduce((sum, backup) => sum + JSON.stringify(backup).length, 0);
    while (totalSize > MAX_AUTO_BACKUP_SIZE && finalAutoBackups.length > 1) {
      finalAutoBackups.pop();
      totalSize = finalAutoBackups.reduce((sum, backup) => sum + JSON.stringify(backup).length, 0);
    }
    
    await browser.storage.local.set({ autoBackups: finalAutoBackups });
  }

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_BACKUP_ALARM) {
      await handleAutoBackup();
      return;
    }

    if (alarm.name === BACKGROUND_SYNC_ALARM) {
      await runBackgroundSync();
    }
  });

  // window events
  browser.windows.onRemoved.addListener(async windowId => {
    let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    if (!collectionsToTrack || collectionsToTrack.length === 0) { return; }
    collectionsToTrack = collectionsToTrack.filter(c => c.windowId !== windowId);
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }, { windowTypes: ['normal'] });

  browser.windows.onCreated.addListener(async () => {
    await handleBadge();
  });

  browser.windows.onFocusChanged.addListener(async () => {
    await handleBadge();
  });

  browser.windows.onBoundsChanged.addListener(async window => {
    debounceAutoUpdate(window.id, 5000); // Debounced auto-update
  });

  // tab events
  browser.tabs.onCreated.addListener(async tab => {
    await handleBadge();
    debounceAutoUpdate(tab.windowId, 2000); // Debounced auto-update
  });
  browser.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    const allowedChanges = ['mutedInfo', 'pinned', 'groupId'];
    const allowUpdate = Object.keys(changeInfo).some(key => allowedChanges.includes(key));
    if (('status' in changeInfo && changeInfo.status === 'complete') || allowUpdate) {
      debounceAutoUpdate(tab.windowId, 2000); // Debounced auto-update
    }
  });
  browser.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
    debounceAutoUpdate(detachInfo.oldWindowId, 2000); // Debounced auto-update
    await handleBadge();
  });
  browser.tabs.onAttached.addListener(async (_tabId, attachInfo) => {
    debounceAutoUpdate(attachInfo.newWindowId, 2000); // Debounced auto-update
    await handleBadge();
  });
  browser.tabs.onMoved.addListener(async (_tabId, moveInfo) => {
    debounceAutoUpdate(moveInfo.windowId, 2000); // Debounced auto-update
  });
  browser.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) return;
    await handleBadge();
    debounceAutoUpdate(removeInfo.windowId, 2000); // Debounced auto-update
  });

  // tabGroup events
  browser.tabGroups.onCreated.addListener(async (tabGroup) => {
    debounceAutoUpdate(tabGroup.windowId, 2000, true); // Debounced auto-update with context menu rebuild
  });
  browser.tabGroups.onRemoved.addListener(async (tabGroup) => {
    debounceAutoUpdate(tabGroup.windowId, 2000, true); // Debounced auto-update with context menu rebuild
  });
  browser.tabGroups.onUpdated.addListener(async (tabGroup) => {
    debounceAutoUpdate(tabGroup.windowId, 2000, true); // Debounced auto-update with context menu rebuild
  });

} catch (e) {
  console.error(e)
}
