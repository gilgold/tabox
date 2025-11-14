/* eslint-disable no-undef */
try {
  importScripts('browser-polyfill.min.js');
  importScripts('background-utils.js');
}
catch (e) {
  console.error(e);
}
  let updateInProgress = false;
  
  // Sync throttling to prevent multiple sync operations
  let syncThrottleTimeout = null;
  const throttleSync = async (operation) => {
    if (syncThrottleTimeout) {
      return false;
    }
    
    syncThrottleTimeout = setTimeout(() => {
      syncThrottleTimeout = null;
    }, 2000); // Prevent sync for 2 seconds after last operation
    
    return await operation();
  };

  // Define handleSaveSession first so it's available for throttleSessionSave
  const handleSaveSession = async (updateCurrent = false) => {
    try {
      const windows = await browser.windows.getAll();
      let { sessions } = await browser.storage.local.get('sessions');
      if (sessions === undefined) {
        sessions = [];
      }
      
      let sessionCollections = [];
      for (const window of windows) {
        try {
          const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          const collection = await updateCollection({
            uid: uid,
            name: `Session, ${new Date().toLocaleString()}`,
          }, window.id);
          
          // Only add collection if updateCollection succeeded
          if (collection !== null) {
            sessionCollections.push(collection);
          }
        } catch (windowError) {
          // Continue with other windows
        }
      }

    if (updateCurrent && sessions.length > 0) {
      sessions.shift();
    }

      const sessionObj = {
        timestamp: Date.now(),
        collections: sessionCollections
      }
      
      sessions.unshift(sessionObj);
      if (sessions.length > 5) {
        sessions.pop();
      }
      await browser.storage.local.set({ sessions });
      
    } catch (error) {
      console.error('Error in handleSaveSession:', error);
    }
  };

  // Session save throttling - save at most once every 30 seconds
  let sessionSaveTimeout = null;
  let pendingSessionSave = false;
  const throttleSessionSave = (updateCurrent = false) => {
    pendingSessionSave = true;
    
    if (sessionSaveTimeout) {
      return; // Already scheduled
    }
    
    sessionSaveTimeout = setTimeout(async () => {
      if (pendingSessionSave) {
        await handleSaveSession(updateCurrent);
        pendingSessionSave = false;
      }
      sessionSaveTimeout = null;
    }, 30000); // 30 seconds
  };

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

async function setInitialOptions() {
  const {
    tabsArray,
    chkOpenNewWindow,
    collectionsToTrack,
    localTimestamp,
    chkEnableTabDiscard,
    currentSortValue,
  } = await browser.storage.local.get([
    'tabsArray',
    'chkOpenNewWindow',
    'collectionsToTrack',
    'localTimestamp',
    'chkEnableTabDiscard',
    'currentSortValue',
  ]);
  if (tabsArray === undefined || tabsArray == {}) {
    await browser.storage.local.set({ tabsArray: [] });
  }
  if (localTimestamp === undefined || localTimestamp == {}) {
    await browser.storage.local.set({ localTimestamp: 0 });
  }
  if (collectionsToTrack === undefined || collectionsToTrack == {}) {
    await browser.storage.local.set({ collectionsToTrack: [] });
  }
  if (chkOpenNewWindow === undefined || chkOpenNewWindow == {}) {
    await browser.storage.local.set({ chkOpenNewWindow: true });
  }
  if (chkEnableTabDiscard === undefined || chkEnableTabDiscard == {}) {
    await browser.storage.local.set({ chkEnableTabDiscard: true });
  }
  if (currentSortValue === undefined || currentSortValue == {}) {
    await browser.storage.local.set({ currentSortValue: 'DATE' });
  }
}

async function handleBadge() {
  const { chkShowBadge } = await browser.storage.local.get('chkShowBadge');
  if (!chkShowBadge) {
    browser.action.setBadgeText({ text: '' });
    return;
  }
  const tabCount = (await browser.tabs.query({ windowId: browser.windows.WINDOW_ID_CURRENT })).length;
  let badgeColor;
  if (tabCount <= 20) badgeColor = '#07A361';
  if (tabCount > 20 && tabCount <= 50) badgeColor = '#DF9402';
  if (tabCount > 50) badgeColor = '#DB392F';
  browser.action.setBadgeBackgroundColor({ color: badgeColor });
  browser.action.setBadgeText({ text: tabCount.toString() });
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
    } catch (e) {
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
    }
    
    // Note: Legacy storage will be updated during sync operations
    // No need to load all 42 collections on every tab event - that's inefficient!
    
    if (updateInProgress) { return; }
    updateInProgress = true;
    
    if (rebuildContextMenus && JSON.stringify(tabsArray[index].chromeGroups) !== JSON.stringify(newCollection.chromeGroups)) {
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
    
    const token = await getAuthToken();
    if (token === false) {
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
    
    const result = await updateRemote(token);
    if (result === false) {
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
    return true;
  } catch (error) {
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

// Optimized openTabs function for better performance with large collections
async function openTabs(collection, window, newWindow = null) {
  const startTime = Date.now();
  const totalTabs = collection.tabs.length;
  
  // Early return for empty collections
  if (totalTabs === 0) {
    return true;
  }
  
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
  
  // Pre-process all tabs to avoid repeated work
  const tabsToCreate = [];
  const firstTabUpdate = isNewWindow(window);
  
  for (let index = 0; index < totalTabs; index++) {
    const tabInGrp = collection.tabs[index];
    
    // Skip duplicates
    if (duplicateUrls.has(tabInGrp.url)) {
      continue;
    }
    
    // Pre-calculate deferred URL
    const shouldDefer = chkEnableTabDiscard && shouldDiscardTab(tabInGrp);
    const finalUrl = shouldDefer 
      ? `${runtimeUrl}?url=${encodeURIComponent(tabInGrp.url)}&favicon=${encodeURIComponent(tabInGrp?.favIconUrl || '')}`
      : tabInGrp.url;
    
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
          const { windowId, ...updateProps } = tabData.properties;
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
  try {
    await Promise.all([
      applyChromeGroupSettings(window.id, collection),
      addCollectionToTrack(collection.uid, window.id)
    ]);
  } catch (groupError) {
    console.error('Error applying chrome groups or tracking:', groupError);
  }
  
  return successCount > 0; // Return true if at least one tab was created successfully
}

try {
  browser.runtime.onMessage.addListener(async (request) => {
    if (request.type === 'checkSyncStatus') {
      try {
        const { googleUser } = await browser.storage.local.get('googleUser');
        if (!googleUser) {
          logSyncOperation('info', 'No Google user found for sync status check');
          return Promise.resolve(false);
        }
        
        // Try to get auth token with improved error handling
        const token = await getAuthToken();
        if (token === false) {
          // Check if we have a refresh token - if so, this might be recoverable
          const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
          if (googleRefreshToken) {
            logSyncOperation('info', 'Auth token failed but refresh token available, sync may recover automatically');
            // Return user info so UI doesn't completely disable sync
            return Promise.resolve({ ...googleUser, syncStatus: 'auth_refreshing' });
          } else {
            logSyncOperation('error', 'No auth token and no refresh token available');
            return Promise.resolve(false);
          }
        }
        
        // Try to verify sync file exists/create it
        const syncFileSuccess = await getOrCreateSyncFile(token);
        if (syncFileSuccess === false) {
          logSyncOperation('error', 'Failed to get or create sync file');
          // Don't return false immediately - sync might still work
          return Promise.resolve({ ...googleUser, syncStatus: 'sync_file_error' });
        }
        
        // Get updated user info to confirm everything is working
        const user = await getGoogleUser(token);
        if (!user) {
          logSyncOperation('error', 'Failed to get user info');
          // Return cached user info with error status
          return Promise.resolve({ ...googleUser, syncStatus: 'user_info_error' });
        }
        
        logSyncOperation('success', 'Sync status check completed successfully');
        return Promise.resolve({ ...user, syncStatus: 'active' });
        
      } catch (error) {
        logSyncOperation('error', 'Exception in checkSyncStatus', { error: error.message });
        // Return cached user info if available
        const { googleUser } = await browser.storage.local.get('googleUser');
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
          preSyncBackups,
          autoBackups,
          versionBackup: backup
        });
      } catch (error) {
        console.error('Error getting backup options:', error);
        return Promise.resolve({ preSyncBackups: [], autoBackups: [], versionBackup: null });
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
          await browser.storage.local.set({ 
            tabsArray: backupData.tabsArray,
            localTimestamp: Date.now() // Mark as newly updated
          });
          return Promise.resolve(true);
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
        
        const syncFileResult = await getOrCreateSyncFile(token);
        if (syncFileResult === false) {
          console.error('Failed to create/find sync file during login');
          return Promise.resolve(false);
        }
        
        const user = await getGoogleUser(token);
        if (!user) {
          console.error('Failed to get user info during login');
          return Promise.resolve(false);
        }
        
        const syncResult = await syncData(token);
        if (syncResult === false) {
          console.error('Initial sync failed during login');
          // Still return user as login was successful, sync can be retried
        }
        
        return Promise.resolve(user);
      } catch (error) {
        console.error('Exception during login:', error);
        return Promise.resolve(false);
      }
    }
    if (request.type === 'openTabs') {
      await openTabs(request.collection, request.window);
      return Promise.resolve(true);
    }

    if (request.type === 'updateBadge') {
      await handleBadge();
      return Promise.resolve(true);
    }

    if (request.type === 'updateRemote') {
      try {
        // Use throttled sync to prevent multiple simultaneous operations
        const result = await throttleSync(() => handleRemoteUpdate());
        if (result === false && syncThrottleTimeout) {
          // Operation was throttled, return success to prevent error handling
          return Promise.resolve(true);
        }
        
        if (result === false) {
          logSyncOperation('error', 'Remote update failed');
        }
        // Success is already logged by handleRemoteUpdate(), no need to log again
        return Promise.resolve(result);
      } catch (error) {
        logSyncOperation('error', 'Exception in updateRemote', { error: error.message });
        console.error('Exception in updateRemote:', error);
        return Promise.resolve(false);
      }
    }

    if (request.type === 'loadFromServer') {
      try {
        const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
        if (!googleRefreshToken) {
          logSyncOperation('error', 'No refresh token available for loadFromServer');
          return Promise.resolve(false);
        }
        
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
          return Promise.resolve(false);
        }
        
        const newData = await updateLocalDataFromServer(token, request.force);
        if (newData === false) {
          // Actual error occurred - try remote update as fallback
          logSyncOperation('info', 'Server load failed, attempting to update remote as fallback');
          
          const updateResult = await handleRemoteUpdate();
          if (updateResult === false) {
            logSyncOperation('error', 'Failed to update remote after failed server load');
          } else {
            logSyncOperation('success', 'Successfully updated remote after failed server load');
          }
        } else if (newData === 'no_update_needed') {
          // No update needed - data is already in sync
          logSyncOperation('info', 'Local data is already in sync, no action needed');
        } else {
          // Successfully loaded new data from server
          logSyncOperation('success', 'Successfully loaded data from server');
        }
        
        return Promise.resolve(newData);
      } catch (error) {
        logSyncOperation('error', 'Exception in loadFromServer', { error: error.message });
        console.error('Exception in loadFromServer:', error);
        return Promise.resolve(false);
      }
    }

    if (request.type === 'logout') {
      const token = await getAuthToken();
      if (token === false) return Promise.resolve(true);
      await browser.storage.local.remove('googleUser');
      await browser.storage.sync.remove('syncFileId');
      return Promise.resolve(true);
    }

    if (request.type === 'focusWindow') {
      try {
        await browser.windows.update(request.windowId, { focused: true });
        return Promise.resolve(true);
      } catch (error) {
        console.log('Failed to focus window, it may have been closed:', request.windowId);
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
  });
  browser.commands.onCommand.addListener(async (command) => {
    try {
      const index = parseInt(command.replace('open-collection-', '')) - 1;
      // 🚀 NEW: Load from indexed storage
      const tabsArray = await loadAllCollectionsBG(true);
      if (!tabsArray || tabsArray.length === 0 || index > tabsArray.length - 1) return;
      console.log(`opening collection with keyboard shortcut: '${tabsArray[index].name}'`);
      
      let window;
      const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
      if (chkOpenNewWindow) {
        window = await browser.windows.create({ focused: true });
      } else {
        window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
      }
      
      window.tabs = await browser.tabs.query({ windowId: window.id });
      await openTabs(tabsArray[index], window, true);
    } catch (error) {
      console.error('Error in keyboard shortcut handler:', error);
    }
  });

  const handleMenuClick = async (info, tab) => {
    if (info.menuItemId === 'tabox-super') return;
    // 🚀 NEW: Load from indexed storage
    let tabsArray = await loadAllCollectionsBG(true);
    let tabToAdd = { ...tab };
    const isClickOnTabGroup = info?.menuItemId?.includes('-main');
    const collectionUid = isClickOnTabGroup ? info?.parentMenuItemId?.replace('-main', '') : info.menuItemId;
    const collectionIndex = tabsArray.findIndex(c => c.uid === collectionUid);
    if (isClickOnTabGroup) {
      // add to inside a chrome group
      const groupUid = info.menuItemId.split('|')[1];
      const group = tabsArray[collectionIndex].chromeGroups?.find(cg => cg.uid === groupUid);
      const indexInTabs = tabsArray[collectionIndex].tabs.findIndex(t => t.groupUid === group.uid);
      tabToAdd.groupId = group.id;
      tabToAdd.groupUid = group.uid;
      tabsArray[collectionIndex]?.tabs?.splice(indexInTabs, 0, tabToAdd);
    } else {
      tabsArray[collectionIndex]?.tabs?.push(tabToAdd);
    }

    await browser.storage.local.set({ tabsArray });
    await handleRemoteUpdate();
  }

  browser.contextMenus.onClicked.addListener(handleMenuClick);

  const handleAutoBackupAlarm = async () => {
    const alarms = await browser.alarms.getAll();
    const hasAlarm = alarms.some(a => a.name === AUTO_BACKUP_ALARM);
    if (hasAlarm) {
      await browser.alarms.clear(AUTO_BACKUP_ALARM);
    }
    browser.alarms.create(AUTO_BACKUP_ALARM, {
      delayInMinutes: 0.1,
      periodInMinutes: 0.1
    })
  }

  browser.runtime.onInstalled.addListener(async (details) => {
    const previousVersion = details.previousVersion;
    const currentVersion = chrome.runtime.getManifest().version;
    const reason = details.reason;
    
    // Handle migration for updates
    if (reason === "update") {
      console.log(`🔄 Extension updated from ${previousVersion} to ${currentVersion}`);
      
      // Only set update flag if version actually changed
      if (previousVersion !== currentVersion) {
        console.log(`📦 Version change detected: ${previousVersion} → ${currentVersion}`);
        
        // Create version backup (existing behavior)
        // 🚀 NEW: Load from indexed storage
        let tabsArray = await loadAllCollectionsBG(true);
        if (tabsArray && tabsArray.length > 0) {
          tabsArray = updateCollectionsUids(tabsArray);
          const backupObj = {
            version: previousVersion,
            tabsArray: tabsArray,
            timestamp: Date.now()
          }
          await browser.storage.local.set({ backup: backupObj });
        }
        
        // Migration will be handled by the main app on next startup
        // This ensures migrations run in the proper context with full access to utilities
        console.log('🔄 Extension updated - migration will be handled when app opens');
        
        // Set a flag to indicate an update occurred
        await browser.storage.local.set({ 
          extensionUpdated: true,
          updateTimestamp: Date.now(),
          previousVersion: previousVersion,
          currentVersion: currentVersion
        });
      } else {
        console.log('📦 Extension reinstalled with same version - no migration needed');
      }
    } else if (reason === "install") {
      console.log(`🎉 Extension installed: version ${currentVersion}`);
      // Mark as fresh install - no migration needed
      await browser.storage.local.set({ 
        extensionInstalled: true,
        installTimestamp: Date.now(),
        installedVersion: currentVersion
      });
    }
    
      await setInitialOptions();
  await handleContextMenuCreation();
  await handleBadge();
  await handleAutoBackupAlarm();
  
  // Clean up large backups on startup (after 5 seconds to not block initialization)
  setTimeout(async () => {
    try {
      await cleanupLargeBackups();
    } catch (error) {
      console.error('Error during startup backup cleanup:', error);
    }
  }, 5000);
  })

  const handleAutoBackup = async () => {
    let { autoBackups } = await browser.storage.local.get('autoBackups');
    // 🚀 NEW: Load from indexed storage
    const tabsArray = await loadAllCollectionsBG(true);
    const { localTimestamp } = await browser.storage.local.get('localTimestamp');
    if (autoBackups === undefined) {
      autoBackups = [];
    }
    if ((tabsArray && tabsArray.length === 0) || (autoBackups.length > 0 && autoBackups[0].timestamp === localTimestamp)) {
      return;
    }
    const backupObj = {
      timestamp: localTimestamp || Date.now(),
      tabsArray
    }
    autoBackups.unshift(backupObj);
    
    // Aggressive auto-backup limits to save storage and memory
    const MAX_AUTO_BACKUPS = 2; // Reduced from 3 for memory optimization
    const MAX_AUTO_BACKUP_SIZE = 1.5 * 1024 * 1024; // 1.5MB limit
    
    if (autoBackups.length > MAX_AUTO_BACKUPS) {
      autoBackups = autoBackups.slice(0, MAX_AUTO_BACKUPS);
    }
    
    // Check size and remove oldest if needed
    let totalSize = autoBackups.reduce((sum, backup) => sum + JSON.stringify(backup).length, 0);
    while (totalSize > MAX_AUTO_BACKUP_SIZE && autoBackups.length > 1) {
      autoBackups.pop();
      totalSize = autoBackups.reduce((sum, backup) => sum + JSON.stringify(backup).length, 0);
    }
    
    await browser.storage.local.set({ autoBackups });
  }

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_BACKUP_ALARM) {
      await handleAutoBackup();
    }
  });

  // window events
  browser.windows.onRemoved.addListener(async windowId => {
    throttleSessionSave(); // Throttled session save
    let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    if (!collectionsToTrack || collectionsToTrack.length === 0) { return; }
    collectionsToTrack = collectionsToTrack.filter(c => c.windowId !== windowId);
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }, { windowTypes: ['normal'] });

  browser.windows.onCreated.addListener(async () => {
    await handleBadge();
    throttleSessionSave(); // Throttled session save
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
    throttleSessionSave(true); // Throttled session save
  });
  browser.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    throttleSessionSave(true); // Throttled session save
    const allowedChanges = ['mutedInfo', 'pinned', 'groupId'];
    const allowUpdate = Object.keys(changeInfo).some(key => allowedChanges.includes(key));
    if (('status' in changeInfo && changeInfo.status === 'complete') || allowUpdate) {
      debounceAutoUpdate(tab.windowId, 2000); // Debounced auto-update
    }
  });
  browser.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
    throttleSessionSave(true); // Throttled session save
    debounceAutoUpdate(detachInfo.oldWindowId, 2000); // Debounced auto-update
    await handleBadge();
  });
  browser.tabs.onAttached.addListener(async (_tabId, attachInfo) => {
    throttleSessionSave(true); // Throttled session save
    debounceAutoUpdate(attachInfo.newWindowId, 2000); // Debounced auto-update
    await handleBadge();
  });
  browser.tabs.onMoved.addListener(async (_tabId, moveInfo) => {
    throttleSessionSave(true); // Throttled session save
    debounceAutoUpdate(moveInfo.windowId, 2000); // Debounced auto-update
  });
  browser.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
    throttleSessionSave(true); // Throttled session save
    if (removeInfo.isWindowClosing) return;
    await handleBadge();
    debounceAutoUpdate(removeInfo.windowId, 2000); // Debounced auto-update
  });

  // tabGroup events
  browser.tabGroups.onCreated.addListener(async (tabGroup) => {
    throttleSessionSave(true); // Throttled session save
    debounceAutoUpdate(tabGroup.windowId, 2000, true); // Debounced auto-update with context menu rebuild
  });
  browser.tabGroups.onRemoved.addListener(async (tabGroup) => {
    throttleSessionSave(true); // Throttled session save
    debounceAutoUpdate(tabGroup.windowId, 2000, true); // Debounced auto-update with context menu rebuild
  });
  browser.tabGroups.onUpdated.addListener(async (tabGroup) => {
    throttleSessionSave(true); // Throttled session save
    debounceAutoUpdate(tabGroup.windowId, 2000, true); // Debounced auto-update with context menu rebuild
  });
} catch (e) {
  console.error(e)
}