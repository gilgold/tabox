/* eslint-disable no-useless-escape */
import './App.css';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Header from './Header';
import AddNewTextbox from './AddNewTextbox';
import CollectionList from './CollectionList';
import Footer from './Footer';
import { useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
import { highlightedCollectionUidState } from './atoms/animationsState';
import {
    settingsDataState,
    themeState,
    isLoggedInState,
    syncInProgressState,
    lastSyncTimeState,
    searchState,
    listKeyState,
} from './atoms/globalAppSettingsState';

import { browser } from '../static/globals';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import ReactTooltip from 'react-tooltip';
import { CollectionListOptions } from './CollectionListOptions';

// New indexed storage utilities
import {
    loadAllCollections,
    loadMultipleCollections,
    loadSingleCollection,
    saveSingleCollection,
    deleteSingleCollection,
    migrateLegacyStorage,
    getStorageStats as getNewStorageStats,
    batchUpdateCollections,
    loadCollectionsIndex,
    loadAllFolders,
    updateFoldersOrder,
    STORAGE_KEYS,
    CURRENT_STORAGE_VERSION
} from './utils/storageUtils';

// Folder operations
import { createFolder } from './utils/folderOperations';

// Migration system imports - wrapped in try/catch for compatibility
const PERF_NAMESPACE = 'tabox:popup';
const PERF_MEASURE_PREFIX = `${PERF_NAMESPACE}:measure:`;

const makeMarkName = (label) => `${PERF_NAMESPACE}:${label}`;

const markPerformancePoint = (label) => {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') {
    return;
  }

  try {
    performance.mark(makeMarkName(label));
  } catch (error) {
    console.warn(`Performance mark failed for ${label}`, error);
  }
};

const measurePerformanceSegment = (label, startLabel, endLabel) => {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
    return null;
  }

  try {
    const measureName = `${PERF_MEASURE_PREFIX}${label}`;
    return performance.measure(measureName, makeMarkName(startLabel), makeMarkName(endLabel));
  } catch (error) {
    console.warn(`Performance measure failed for ${label}`, error);
    return null;
  }
};

const logPerformanceSummary = () => {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return;
  }

  const measures = performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(PERF_MEASURE_PREFIX))
    .map((entry) => ({
      segment: entry.name.replace(PERF_MEASURE_PREFIX, ''),
      duration: `${entry.duration.toFixed(2)}ms`,
    }));

  if (!measures.length) {
    console.info('[Tabox] No popup performance measures recorded yet.');
    return;
  }

  console.groupCollapsed('[Tabox] Popup performance summary');
  console.table(measures);
  console.groupEnd();
};

const shouldAutoLogPerformance = () => {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage?.getItem('TABOX_DEBUG_PERF') === '1';
  } catch (error) {
    console.warn('Unable to read TABOX_DEBUG_PERF flag', error);
    return false;
  }
};

const INITIAL_COLLECTION_BATCH_SIZE = 20;
const HYDRATION_BATCH_SIZE = 50;
const MIGRATION_SESSION_KEY = 'tabox:migrationChecked';

const runWhenIdle = () => {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve());
      return;
    }

    setTimeout(resolve, 32);
  });
};

const hasSessionMigrationCheck = () => {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return false;
  }

  try {
    return window.sessionStorage.getItem(MIGRATION_SESSION_KEY) === '1';
  } catch (error) {
    console.warn('Unable to read migration session flag', error);
    return false;
  }
};

const markSessionMigrationComplete = () => {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(MIGRATION_SESSION_KEY, '1');
  } catch (error) {
    console.warn('Unable to persist migration session flag', error);
  }
};

const shouldExposeDebugUtilities = () => {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage?.getItem('TABOX_ENABLE_DEBUG_UTILS') === '1';
  } catch (error) {
    console.warn('Unable to read TABOX_ENABLE_DEBUG_UTILS flag', error);
    return false;
  }
};

if (typeof window !== 'undefined') {
  markPerformancePoint('start');
  window.__TABOX_LOG_POPUP_PERF__ = logPerformanceSummary;
}

let migrationSystemAvailable = false;
let assessMigrationNeeds, executeMigration, isDataSafe;

function App() {
  const [settingsData, setSettingsData] = useRecoilState(settingsDataState);
  const setHighlightedCollectionUid = useSetRecoilState(highlightedCollectionUidState);
  const [themeMode, setThemeMode] = useRecoilState(themeState);
  const [isLoggedIn, setIsLoggedIn] = useRecoilState(isLoggedInState);
  const setSyncInProgress = useSetRecoilState(syncInProgressState);
  const setLastSyncTime = useSetRecoilState(lastSyncTimeState);
  const [openSuccessSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS });
  const [openErrorSnackbar] = useSnackbar({ style: SnackbarStyle.ERROR });
  const search = useRecoilValue(searchState);
  const [listKey, setListKey] = useRecoilState(listKeyState);
  const [sortValue, setSortValue] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'
  const [filters, setFilters] = useState({ recentlyOpenedActual: false, color: null });
  
  // Mount tracking to prevent memory leaks
  const isMountedRef = useRef(true);

  // Track if migration is currently running
  const [migrationInProgress, setMigrationInProgress] = useState(false);
  const [migrationChecked, setMigrationChecked] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Lightning effect state for manually updated collections
  const [lightningEffectUid, setLightningEffectUid] = useState(null);
  
  // Lightning effect state for folders when collections are dropped into them
  const [lightningEffectFolderUid, setLightningEffectFolderUid] = useState(null);

  // Storage performance tracking
  const [storageStats, setStorageStats] = useState(null);

  // Folders state management
  const [foldersData, setFoldersData] = useState([]);
  const [performanceDataReady, setPerformanceDataReady] = useState(false);
  const [performanceSummaryLogged, setPerformanceSummaryLogged] = useState(false);
  const performanceMarksRef = useRef({ critical: false, data: false });
  const metadataUidOrderRef = useRef([]);
  const markDataHydrationComplete = useCallback(() => {
    if (!performanceMarksRef.current.data) {
      markPerformancePoint('data-ready');
      performanceMarksRef.current.data = true;
    }
    setPerformanceDataReady(true);
  }, [setPerformanceDataReady]);
  
  // Update folders with proper order persistence
  const updateFolders = async (newFolders) => {
    try {
      // Update local state immediately for responsive UI
      setFoldersData(newFolders);
      
      // Persist the new order to storage
      const success = await updateFoldersOrder(newFolders);
      
      if (!success) {
        console.error('❌ App.js: Failed to save folder order, reverting...');
        // Revert to original order on failure
        await refreshDataAfterFolderOperation();
      } else {
        // Trigger sync for folder reordering
        await browser.storage.local.set({ localTimestamp: Date.now() });
        await browser.runtime.sendMessage({ type: 'addCollection' });
        triggerSync();
        // Refresh data to ensure UI reflects actual storage state
        await refreshDataAfterFolderOperation();
      }
      
      return success;
    } catch (error) {
      console.error('❌ App.js: Error updating folders:', error);
      return false;
    }
  };

  // Initialize migration system safely
  const initializeMigrationSystem = async () => {
    if (migrationSystemAvailable) return true;
    
    try {
      // Check if we're in browser extension context
      if (!browser || !browser.storage) {
        return false;
      }
      
      // First, run a health check
      const { isMigrationSystemHealthy } = await import('./utils/migrationHealthCheck');
      const isHealthy = await isMigrationSystemHealthy();
      
      if (!isHealthy) {
        console.warn('⚠️ Migration system health check failed - will use fallback mode');
        return false;
      }
      
      // Load migration functions
      const migrationModule = await import('./utils/migrationCoordinator');
      const validationModule = await import('./utils/dataValidation');
      
      assessMigrationNeeds = migrationModule.assessMigrationNeeds;
      executeMigration = migrationModule.executeMigration;
      isDataSafe = validationModule.isDataSafe;
      
      migrationSystemAvailable = true;
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize migration system:', error);
      return false;
    }
  };

  const removeInactiveWindowsFromAutoUpdate = async () => {
    let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
    if (!collectionsToTrack || collectionsToTrack.length === 0 || !chkEnableAutoUpdate) { return; }
    const activeWindowIds = (await browser.windows.getAll({ populate: false })).map(c => c.id);
    collectionsToTrack = collectionsToTrack.filter(c => activeWindowIds.includes(c.windowId));
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }

  const applyTheme = async () => {
    let { theme } = await browser.storage.local.get('theme');
    theme = theme ? theme : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setThemeMode(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Phase 2: Batch initial storage operations for better performance
  const loadInitialSettings = async () => {
    const initialData = await browser.storage.local.get([
      'theme',
      'currentSortValue',
      'collectionViewMode',
      'extensionUpdated',
      'previousVersion',
      'updateTimestamp'
    ]);
    
    // Apply theme immediately
    const theme = initialData.theme || 
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setThemeMode(theme);
    document.documentElement.setAttribute('data-theme', theme);
    
    // Set sort value
    setSortValue(initialData.currentSortValue || 'DATE');
    
    // Set view mode
    setViewMode(initialData.collectionViewMode || 'list');
    
    if (!performanceMarksRef.current.critical) {
      markPerformancePoint('critical-ready');
      performanceMarksRef.current.critical = true;
    }
    
    // Return update flags for migration check
    return {
      extensionUpdated: initialData.extensionUpdated,
      previousVersion: initialData.previousVersion
    };
  }

  const checkSyncStatus = async () => {
    // Phase 4: Show cached status immediately
    const { googleUser, googleRefreshToken } = await browser.storage.local.get(['googleUser', 'googleRefreshToken']);
    if (isMountedRef.current) {
      setIsLoggedIn(!!googleUser); // Show cached status
    }
    
    // Then check actual status in background
    if (!googleRefreshToken) return;
    
    browser.runtime.sendMessage({ type: 'checkSyncStatus' }).then(async (response) => {
      if (isMountedRef.current) {
        setIsLoggedIn(response === null ? false : response);
        if (response) await applyDataFromServer();
      }
    });
  }

  const _handleSyncError = async () => {
    await browser.storage.local.remove('googleToken');
    await browser.storage.local.remove('googleUser');
    setIsLoggedIn(false);
    openErrorSnackbar('Error syncing data, please enable sync again', 6000);
  }

  const logout = async () => {
    browser.runtime.sendMessage({ type: 'logout' }).then(() => {
      setIsLoggedIn(false);
    })
  };

  const applyDataFromServer = async (force = false) => {
    setSyncInProgress(true);
    browser.runtime.sendMessage({ type: 'loadFromServer', force: force }).then(async (response) => {
      if (response !== false) {
        // Use new storage system for server data
        
        if (response && Array.isArray(response) && response.length > 0) {
          const success = await batchUpdateCollections(response);
          if (success) {
            // Add a small delay to ensure storage writes are committed
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Load user's sort preferences
            const { currentSortValue, currentSortAscending } = await browser.storage.local.get(['currentSortValue', 'currentSortAscending']);
            const sortValue = currentSortValue || 'DATE';
            const sortAscending = currentSortAscending !== undefined ? currentSortAscending : true;
            const sortFieldMap = { 'DATE': 'lastUpdated', 'NAME': 'name', 'COLOR': 'color' };
            const sortBy = sortFieldMap[sortValue] || 'lastUpdated';
            const sortOrder = sortAscending ? 'asc' : 'desc';
            
            // Reload both collections and folders from storage after sync
            const [updatedCollections, updatedFolders] = await Promise.all([
              loadAllCollections({ metadataOnly: false, sortBy, sortOrder }),
              loadAllFolders({ metadataOnly: false })
            ]);
            
            setSettingsData(updatedCollections);
            setFoldersData(updatedFolders);
            setLastSyncTime(Date.now());
          } else {
            console.error('❌ Failed to save server data');
          }
        } else if (response === 'no_update_needed') {
          // Don't reload data if sync says nothing changed
          // The data is already loaded correctly in loadDataWithNewSystem
          setLastSyncTime(Date.now());
        } else {
          setSettingsData([]);
          setFoldersData([]);
          setLastSyncTime(Date.now());
        }
      }
    }).catch(async (err) => {
      await _handleSyncError(err)
    }).finally(() => {
      setSyncInProgress(false);
    });
  }

  const _update = async () => {
    setSyncInProgress(true);
    browser.runtime.sendMessage({ type: 'updateRemote' }).then(() => {
      setLastSyncTime(Date.now());
    }).catch(async (err) => {
      await _handleSyncError(err)
    }).finally(() => {
      setSyncInProgress(false);
    });
  }

  // Sync trigger for folder operations (without requiring full collections array)
  const triggerSync = async () => {
    if (!isLoggedIn) return;
    _update();
  }

  // Updated to use new storage system
  const updateRemoteData = async (newData) => {

    
    try {
      // Save using new batch update system for better performance
      const success = await batchUpdateCollections(newData);
      
      if (success) {
        setSettingsData(newData);
        await browser.storage.local.set({ localTimestamp: Date.now() });
        await browser.runtime.sendMessage({ type: 'addCollection' });
        
        if (!isLoggedIn) return;
        _update();
        

      } else {
        console.error('❌ Failed to update remote data');
        // Fallback to legacy system if new system fails
        await browser.storage.local.set({ 
          tabsArray: newData,
          localTimestamp: Date.now() 
        });
        setSettingsData(newData);
      }
    } catch (error) {
      console.error('Error updating remote data:', error);
      // Fallback to legacy system
      await browser.storage.local.set({ 
        tabsArray: newData,
        localTimestamp: Date.now() 
      });
      setSettingsData(newData);
    }
  }

  // Updated to use new storage system
  const updateCollection = async (newCollection, isManualUpdate = false) => {
    
    try {
      // Use new single collection update for better performance
      const success = await saveSingleCollection(newCollection, true); // Force timestamp update for user changes
      
      if (success) {
        // Update local state
        const newList = [...settingsData];
        const index = newList.findIndex(c => c.uid === newCollection.uid);
        if (index !== -1) {
          newList[index] = newCollection;
                  setSettingsData(newList);
        }
        
        // Trigger lightning effect for manual updates
        if (isManualUpdate) {
          setLightningEffectUid(newCollection.uid);
          // Clear the effect after animation duration
          setTimeout(() => setLightningEffectUid(null), 700);
        }
        
        // Continue with sync if logged in
        await browser.storage.local.set({ localTimestamp: Date.now() });
        await browser.runtime.sendMessage({ type: 'addCollection' });
        if (!isLoggedIn) return;
        _update();
      } else {
        console.error(`❌ Failed to update collection ${newCollection.uid}`);
        // Fallback to legacy full update
        const newList = [...settingsData];
        const index = newList.findIndex(c => c.uid === newCollection.uid);
        newList[index] = newCollection;
        await updateRemoteData(newList);
      }
    } catch (error) {
      console.error('Error updating collection:', error);
      // Fallback to legacy system
      const newList = [...settingsData];
      const index = newList.findIndex(c => c.uid === newCollection.uid);
      newList[index] = newCollection;
      await updateRemoteData(newList);
    }
  }

  const removeCollection = (collectionUid) => {
    return [...settingsData].filter(c => c.uid !== collectionUid);
  }

  // Trigger lightning effect for folders when collections are dropped into them
  const triggerFolderLightningEffect = (folderUid) => {
    setLightningEffectFolderUid(folderUid);
    // Clear the effect after animation duration
    setTimeout(() => setLightningEffectFolderUid(null), 700);
  };

  // Updated to use new storage system
  const addCollection = async (newCollection, skipContextMenuUpdate = false, skipStateUpdate = false) => {
    try {
      // Use new single collection save for better performance
      const success = await saveSingleCollection(newCollection, true); // Force timestamp update for new collections
      
      if (success) {
        // Update local state (skip for batch operations to prevent race conditions)
        if (!skipStateUpdate) {
          const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
          setSettingsData(newList);
          setHighlightedCollectionUid(newCollection.uid);
        }
        
        // Continue with sync and auto-update logic
        await browser.storage.local.set({ localTimestamp: Date.now() });
        
        // Only trigger context menu update if not skipped (to prevent race conditions in batch operations)
        if (!skipContextMenuUpdate) {
          await browser.runtime.sendMessage({ type: 'addCollection' });
        }
        
        // Only sync if logged in - throttling prevents duplicate syncs
        if (isLoggedIn && !skipStateUpdate) {
          _update();
        }
        
        // Auto-update tracking logic (only for successful saves)
        const { chkAutoUpdateOnNewCollection } = await browser.storage.local.get('chkAutoUpdateOnNewCollection');
        if (!chkAutoUpdateOnNewCollection) return true;
        setTimeout(async () => {
          const storageResult = await browser.storage.local.get('collectionsToTrack');
          let collectionsToTrack = storageResult.collectionsToTrack || [];
          let window;
          try {
            window = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
          } catch (error) {
            return;
          }
          const index = collectionsToTrack.findIndex(c => c.collectionUid === newCollection.uid);
          if (index !== undefined && index > -1) {
              collectionsToTrack[index].windowId = window.id;
          } else {
              collectionsToTrack.push({
                  collectionUid: newCollection.uid,
                  windowId: window.id
              });
          }
          await browser.storage.local.set({ collectionsToTrack });
          setListKey(Math.random().toString(36));
        }, 1000);
        
        return true;
      } else {
        console.error(`❌ Failed to add collection ${newCollection.uid}`);
        // Fallback to legacy system - always attempt fallback even if skipStateUpdate is true
        // We just won't update React state, but we should still try to save the data
        try {
          const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
          if (!skipStateUpdate) {
            setHighlightedCollectionUid(newCollection.uid);
          }
          await updateRemoteData(newList);
          return true;
        } catch (fallbackError) {
          console.error('Fallback save also failed:', fallbackError);
          return false;
        }
      }
      
    } catch (error) {
      console.error('Error adding collection:', error);
      // Fallback to legacy system
      try {
        const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
        if (!skipStateUpdate) {
          setHighlightedCollectionUid(newCollection.uid);
        }
        await updateRemoteData(newList);
        return true;
      } catch (fallbackError) {
        console.error('Fallback save also failed:', fallbackError);
        return false;
      }
    }
  }

  // Folder management functions
  const addFolder = async (name, color, collapsed = false) => {
    try {
      const newFolder = await createFolder(name, color, collapsed);
      
      if (newFolder) {
        // Update local folders state
        const newFolders = [newFolder, ...foldersData];
        setFoldersData(newFolders);
        
        openSuccessSnackbar(`Folder "${newFolder.name}" created successfully`, 2000);
        return newFolder;
      } else {
        console.error(`❌ Failed to create folder: ${name}`);
        openErrorSnackbar(`Failed to create folder`, 2000);
        return null;
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      openErrorSnackbar(`Failed to create folder: ${error.message}`, 3000);
      return null;
    }
  };

  // Function to refresh both collections and folders data
  const refreshDataAfterFolderOperation = async () => {
    try {
      // Load user's sort preferences
      const { currentSortValue, currentSortAscending } = await browser.storage.local.get(['currentSortValue', 'currentSortAscending']);
      const sortValue = currentSortValue || 'DATE';
      const sortAscending = currentSortAscending !== undefined ? currentSortAscending : true;
      const sortFieldMap = { 'DATE': 'lastUpdated', 'NAME': 'name', 'COLOR': 'color' };
      const sortBy = sortFieldMap[sortValue] || 'lastUpdated';
      const sortOrder = sortAscending ? 'asc' : 'desc';
      
      // Reload both collections and folders to reflect changes
      const [collections, folders] = await Promise.all([
        loadAllCollections({ metadataOnly: false, sortBy, sortOrder }),
        loadAllFolders({ metadataOnly: false })
      ]);
      
      setSettingsData(collections);
      setFoldersData(folders);
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };
  
  // Lightweight function to update a single folder in state (for UI-only changes like collapsed state)
  const updateSingleFolderInState = (updatedFolder) => {
    setFoldersData(prevFolders => 
      prevFolders.map(f => f.uid === updatedFolder.uid ? updatedFolder : f)
    );
  };

  const hydrateCollectionsInBatches = useCallback(async (metadataList, startIndex = 0) => {
    if (!metadataList || metadataList.length === 0) {
      setDataLoaded(true);
      markDataHydrationComplete();
      return;
    }

    const metadataLookup = new Map(metadataList.map((item) => [item.uid, item]));
    let currentIndex = Math.max(startIndex, 0);

    if (currentIndex >= metadataList.length) {
      setDataLoaded(true);
      markDataHydrationComplete();
      return;
    }

    while (currentIndex < metadataList.length) {
      const chunk = metadataList.slice(currentIndex, currentIndex + HYDRATION_BATCH_SIZE);
      const chunkUids = chunk.map((item) => item.uid).filter(Boolean);

      if (chunkUids.length) {
        const chunkDataMap = await loadMultipleCollections(chunkUids);

        setSettingsData((previousCollections = []) => {
          const collectionMap = new Map();

          previousCollections.forEach((collection) => {
            if (collection?.uid) {
              collectionMap.set(collection.uid, collection);
            }
          });

          chunkUids.forEach((uid) => {
            if (chunkDataMap[uid]) {
              const fallbackOrder = metadataLookup.get(uid)?.order;
              collectionMap.set(uid, {
                ...chunkDataMap[uid],
                order: chunkDataMap[uid].order ?? fallbackOrder,
              });
            }
          });

          return metadataUidOrderRef.current
            .map((uid) => collectionMap.get(uid))
            .filter(Boolean);
        });
      }

      currentIndex += HYDRATION_BATCH_SIZE;
      await runWhenIdle();
    }

    setDataLoaded(true);
    markDataHydrationComplete();
  }, [markDataHydrationComplete, setSettingsData, loadMultipleCollections]);

  // Updated to use new storage system with performance improvements
  const loadCollectionsFromStorage = async (updateFlags = null) => {
    // Prevent multiple simultaneous loads
    if (dataLoading) {
      return;
    }
    
    if (dataLoaded && settingsData?.length > 0) {
      return;
    }
    
    setDataLoading(true);
    const migrationAlreadyChecked = migrationChecked || hasSessionMigrationCheck();
    
    try {
      // Check for extension updates and run migrations safely
      let extensionUpdated = false;
      let previousVersion = null;
      
      // Prevent duplicate migration checks
      if (migrationAlreadyChecked) {
        await loadDataWithNewSystem();
        return;
      }
      
      // Use passed flags or fetch them
      if (updateFlags) {
        extensionUpdated = updateFlags.extensionUpdated;
        previousVersion = updateFlags.previousVersion;
      } else {
        // Fallback: fetch if not provided
        const updateData = await browser.storage.local.get([
          'extensionUpdated', 'previousVersion', 'updateTimestamp'
        ]);
        extensionUpdated = updateData.extensionUpdated;
        previousVersion = updateData.previousVersion;
      }
      
      if (extensionUpdated) {
        // Clear the update flag
        await browser.storage.local.remove(['extensionUpdated', 'updateTimestamp', 'previousVersion']);
      }
      
      // Mark migration as checked
      setMigrationChecked(true);
      markSessionMigrationComplete();
      
      // Check if migration is already running
      if (migrationInProgress) {
        return;
      }

      // Phase 1: Only run storage migration if needed (extension update OR first-time migration)
      const { [STORAGE_KEYS.STORAGE_VERSION]: storageVersion } = await browser.storage.local.get(STORAGE_KEYS.STORAGE_VERSION);
      
      // Only run storage migration if:
      // 1. Extension was updated, OR
      // 2. Storage version is outdated/missing (first-time migration)
      const needsStorageMigration = extensionUpdated || !storageVersion || storageVersion < CURRENT_STORAGE_VERSION;
      
      if (needsStorageMigration) {
        const storageeMigrationResult = await migrateLegacyStorage();
        
        if (storageeMigrationResult.success && storageeMigrationResult.migrated) {
          openSuccessSnackbar(`Upgraded storage system for ${storageeMigrationResult.count} collections - faster performance!`);
        } else if (!storageeMigrationResult.success) {
          console.warn('⚠️ Storage migration failed, using legacy system');
        }
      }

      // Only run data migration during extension updates
      if (extensionUpdated) {
        // Try to initialize data migration system
        const migrationReady = await initializeMigrationSystem();
        
        if (migrationReady && migrationSystemAvailable) {
          // Check for needed data migrations
          const migrationAssessment = await assessMigrationNeeds();
          
          if (migrationAssessment.migrationNeeded) {
            setMigrationInProgress(true);
            
            try {
              // Show user feedback for migration
              if (migrationAssessment.collections > 10) {
                openSuccessSnackbar(`Migrating ${migrationAssessment.collections} collections to new format...`);
              }
              
              // Execute migration (emergency backup is handled internally now)
              const migrationResult = await executeMigration();
              
              if (migrationResult.success && !migrationResult.skipped) {
                openSuccessSnackbar('Extension updated and data migrated successfully!');
              } else if (migrationResult.skipped) {
                openSuccessSnackbar('Extension updated successfully');
              } else {
                console.error('❌ Data migration failed:', migrationResult.error);
                openErrorSnackbar('Extension updated but data migration failed - your data has been preserved');
              }
            } finally {
              setMigrationInProgress(false);
            }
          } else {
            openSuccessSnackbar('Extension updated successfully');
          }
        } else {
          openSuccessSnackbar(`Extension updated from ${previousVersion} - data loading in compatibility mode`);
        }
      }

      await loadDataWithNewSystem();
      
    } catch (migrationError) {
      console.error('❌ Migration check/execution failed:', migrationError);
      if (extensionUpdated) {
        openErrorSnackbar(`Extension updated but migration failed - continuing with existing data`);
      } else {
        openErrorSnackbar('Migration check failed - extension will continue with existing data');
      }
      // Continue with loading - don't break the app
      await loadDataWithNewSystem();
    } finally {
      setDataLoading(false);
    }
  }

  // Optimized data loading function
  const loadDataWithNewSystem = async () => {
    try {
      // Load user's sort preferences to respect their saved choice
      const { currentSortValue, currentSortAscending } = await browser.storage.local.get(['currentSortValue', 'currentSortAscending']);
      const sortValue = currentSortValue || 'DATE';
      const sortAscending = currentSortAscending !== undefined ? currentSortAscending : true;
      
      // Map user sort preference to storage field name
      const sortFieldMap = {
        'DATE': 'lastUpdated',
        'NAME': 'name',
        'COLOR': 'color'
      };
      const sortBy = sortFieldMap[sortValue] || 'lastUpdated';
      const sortOrder = sortAscending ? 'asc' : 'desc';
      
      const [metadata, folders] = await Promise.all([
        loadAllCollections({
          metadataOnly: true,
          sortBy,
          sortOrder
        }),
        loadAllFolders({
          metadataOnly: false,
          sortBy: 'order',
          sortOrder: 'asc'
        })
      ]);

      metadataUidOrderRef.current = metadata.map((item) => item.uid);

      const initialBatchSize = metadata.length > 0 ? Math.min(INITIAL_COLLECTION_BATCH_SIZE, metadata.length) : 0;
      let initialCollections = [];

      if (initialBatchSize > 0) {
        initialCollections = await loadAllCollections({
          metadataOnly: false,
          sortBy,
          sortOrder,
          limit: initialBatchSize
        });
      }

      setSettingsData(initialCollections);
      setFoldersData(folders);

      await hydrateCollectionsInBatches(metadata, initialBatchSize);
      
      // Debug function to check what's in storage
      window.checkStorageData = async () => {
        const allCollections = await loadAllCollections({ metadataOnly: false });
        
        // Check raw storage
        const index = await loadCollectionsIndex();
        
        // Check legacy storage
        const { tabsArray } = await browser.storage.local.get('tabsArray');
      };
      
      // Recovery function to restore tabs from legacy storage
      window.recoverTabsFromLegacy = async () => {
        const { tabsArray } = await browser.storage.local.get('tabsArray');
        
        if (!tabsArray || tabsArray.length === 0) {
          console.error('❌ No legacy data found to recover from');
          return;
        }
        
        // Re-migrate from legacy
        const success = await batchUpdateCollections(tabsArray);
        
        if (success) {
          // Reload data
          await loadDataWithNewSystem();
        } else {
          console.error('❌ Failed to recover tabs');
        }
      };
      
      // Debug function to clear all order fields
      window.clearAllOrderFieldsNow = async () => {
        const allCollections = await loadAllCollections({ metadataOnly: false });
        const cleaned = allCollections.map(c => ({
          ...c,
          order: null  // Explicitly set to null to clear
        }));
        await batchUpdateCollections(cleaned);
        // Reload with current sort preferences
        await loadDataWithNewSystem();
      };
      

      
    } catch (error) {
      console.error('❌ Failed to load data with new system, falling back to legacy:', error);
      
      // Fallback to legacy loading (collections only)
      await loadDataLegacy();
      // Initialize empty folders array for fallback
      setFoldersData([]);
    }
  };

  // Legacy data loading (fallback)
  const loadDataLegacy = async () => {
    const { tabsArray } = await browser.storage.local.get('tabsArray');
    let newCollections = [];
    
    if (tabsArray && tabsArray.length > 0) {
      // Clean up any corrupted or duplicate collections
      const cleanedCollections = [];
      const seenUids = new Set();
      
      tabsArray.forEach((collection) => {
        // Skip if no UID or duplicate UID
        if (!collection.uid || seenUids.has(collection.uid)) {
          console.warn('Skipping duplicate or invalid collection:', collection.uid);
          return;
        }
        
        // Clean up folder-related fields if they exist
        const cleanedCollection = { ...collection };
        delete cleanedCollection.parentId;
        if (cleanedCollection.type === 'folder') {
          console.warn('Skipping folder item:', cleanedCollection.uid);
          return;
        }
        cleanedCollection.type = 'collection';
        
        seenUids.add(collection.uid);
        cleanedCollections.push(cleanedCollection);
      });
      
      // Save cleaned collections back to storage if we removed anything
      if (cleanedCollections.length !== tabsArray.length) {
        await browser.storage.local.set({ tabsArray: cleanedCollections });
        
        // Also clear any folder storage
        await browser.storage.local.remove('foldersArray');
      }
      
      newCollections = cleanedCollections;
    }
    
    setSettingsData(newCollections);
    setDataLoaded(true);
    markDataHydrationComplete();
  };

  // Emergency cleanup function - updated to work with new system
  const emergencyCleanup = async () => {
    // Remove all folder storage
    await browser.storage.local.remove('foldersArray');
    
    // Clean up collections using new system
    try {
      const collections = await loadAllCollections();
      const cleanedCollections = [];
      const seenUids = new Set();
      
      collections.forEach((collection) => {
        if (collection.uid && !seenUids.has(collection.uid) && collection.type !== 'folder') {
          const cleaned = { ...collection };
          delete cleaned.parentId;
          cleaned.type = 'collection';
          cleanedCollections.push(cleaned);
          seenUids.add(collection.uid);
        }
      });
      
      const success = await batchUpdateCollections(cleanedCollections);
      if (!success) {
        throw new Error('Batch update failed');
      }
    } catch (error) {
      // Fallback to legacy cleanup
      const { tabsArray } = await browser.storage.local.get('tabsArray');
      if (tabsArray && tabsArray.length > 0) {
        const cleanedCollections = [];
        const seenUids = new Set();
        
        tabsArray.forEach((collection) => {
          if (collection.uid && !seenUids.has(collection.uid) && collection.type !== 'folder') {
            const cleaned = { ...collection };
            delete cleaned.parentId;
            cleaned.type = 'collection';
            cleanedCollections.push(cleaned);
            seenUids.add(collection.uid);
          }
        });
        
        await browser.storage.local.set({ tabsArray: cleanedCollections });
      }
    }
    
    // Reload data
    await loadCollectionsFromStorage();
  };
  
  // Emergency storage cleanup - updated to work with new system
  const emergencyStorageCleanup = async () => {
    try {
      // Remove all backup data to free space
      const keysToRemove = [
        'autoBackups',
        'preSyncBackups', 
        'sessions',
        'backup_index'
      ];
      
      // Find all backup and migration keys
      const allData = await browser.storage.local.get();
      const backupKeys = Object.keys(allData).filter(key => 
        key.includes('_backup_') || 
        key.includes('migration_') ||
        key.includes('rollback_') ||
        key.includes('emergency_') ||
        key.includes('chunked_data_')
      );
      
      keysToRemove.push(...backupKeys);
      
      if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
      }
      
      openSuccessSnackbar('Emergency cleanup completed - freed storage space');
      
      // Update storage stats
      const newStats = await getNewStorageStats();
      setStorageStats(newStats);
      
      return true;
    } catch (error) {
      console.error('Emergency storage cleanup failed:', error);
      openErrorSnackbar('Emergency cleanup failed: ' + error.message);
      return false;
    }
  };

  // Emergency recovery function using new migration system
  const emergencyRecovery = async () => {
    try {
      // Try to initialize migration system if not already available
      if (!migrationSystemAvailable) {
        const migrationReady = await initializeMigrationSystem();
        if (!migrationReady) {
          throw new Error('Migration system not available for emergency recovery');
        }
      }
      
      const { emergencyDataRecovery } = await import('./utils/index.js');
      const success = await emergencyDataRecovery();
      
      if (success) {
        // Reload data after recovery
        await loadCollectionsFromStorage();
        openSuccessSnackbar('Emergency recovery completed - data restored from backup');
      } else {
        openErrorSnackbar('Emergency recovery failed - no valid backups available');
      }
    } catch (error) {
      console.error('💥 EMERGENCY RECOVERY: Failed:', error);
      openErrorSnackbar('Emergency recovery failed - migration system not available');
    }
  };

  // Make emergency functions available in console
  useEffect(() => {
    if (typeof window === 'undefined' || !shouldExposeDebugUtilities()) {
      return;
    }

    window.emergencyCleanup = emergencyCleanup;
    window.emergencyRecovery = emergencyRecovery;
    window.emergencyStorageCleanup = emergencyStorageCleanup;
    
    // Enhanced storage stats with new system
    window.getStorageStats = async () => {
      const stats = await getNewStorageStats();
      if (stats) {
        if (stats.error) {
          console.warn(`⚠️ Stats Error: ${stats.error}`);
        }
      } else {
        console.error('❌ Failed to get storage stats - returned null');
      }
      
      // Also get browser storage stats
      const data = await browser.storage.local.get();
      const dataString = JSON.stringify(data);
      const browserStats = {
        totalSize: dataString.length,
        totalSizeMB: (dataString.length / (1024 * 1024)).toFixed(2),
        itemCount: Object.keys(data).length,
        items: Object.keys(data).map(key => ({
          key,
          sizeMB: (JSON.stringify(data[key]).length / (1024 * 1024)).toFixed(2)
        })).sort((a, b) => parseFloat(b.sizeMB) - parseFloat(a.sizeMB))
      };
      console.table(browserStats.items);
      return { newSystem: stats, browser: browserStats };
    };
    
    // Migration status checker
    window.getMigrationStatus = async () => {
      try {
        const data = await browser.storage.local.get(['migration_history', 'tabox_schema_version', 'tabox_storage_version']);
        const manifest = (typeof chrome !== 'undefined' && chrome.runtime) ? 
          chrome.runtime.getManifest() : 
          { version: 'unknown' };
        
        const status = {
          currentAppVersion: manifest.version,
          schemaVersion: data.tabox_schema_version || 'not set',
          storageVersion: data.tabox_storage_version || 'legacy',
          migrationHistory: data.migration_history || 'no history',
          extensionContext: typeof chrome !== 'undefined' ? 'extension' : 'standalone'
        };
        
        return status;
      } catch (error) {
        console.error('Error getting migration status:', error);
        return { error: error.message };
      }
    };
    
    // New function to test storage performance
    window.testStoragePerformance = async () => {
      const startTime = performance.now();
      const collections = await loadAllCollections({ metadataOnly: true });
      const metadataTime = performance.now() - startTime;
      
      const fullStartTime = performance.now();
      const fullCollections = await loadAllCollections({ metadataOnly: false, limit: 10 });
      const fullTime = performance.now() - fullStartTime;
      
      const results = {
        metadataOnly: `${metadataTime.toFixed(2)}ms for ${collections.length} collections`,
        fullLoad: `${fullTime.toFixed(2)}ms for 10 collections`,
        avgMetadata: `${(metadataTime / collections.length).toFixed(2)}ms per collection`,
        avgFull: `${(fullTime / 10).toFixed(2)}ms per collection`
      };
      
      console.table(results);
      return results;
    };
    
    // Backup management utilities
    window.checkBackupSizes = async () => {
      try {
        const { preSyncBackups = [], autoBackups = [] } = await browser.storage.local.get(['preSyncBackups', 'autoBackups']);
        const preSyncSize = JSON.stringify(preSyncBackups).length;
        const autoBackupSize = JSON.stringify(autoBackups).length;
        const totalSize = preSyncSize + autoBackupSize;
        
        return { 
          preSyncBackups: preSyncBackups.length,
          autoBackups: autoBackups.length,
          preSyncSize, 
          autoBackupSize, 
          totalSize,
          totalSizeMB: totalSize / 1024 / 1024
        };
      } catch (error) {
        console.error('Error checking backup sizes:', error);
        return null;
      }
    };
    
    window.cleanupBackups = async () => {
      try {
        const result = await browser.runtime.sendMessage({ 
          type: 'cleanupBackups' 
        });
        
        if (result) {
          // Show updated sizes
          await window.checkBackupSizes();
        }
        
        return result;
      } catch (error) {
        console.error('Error during backup cleanup:', error);
        return false;
      }
    };
    
    window.showBackupContents = async () => {
      try {
        const { preSyncBackups = [] } = await browser.storage.local.get(['preSyncBackups']);
        return preSyncBackups;
      } catch (error) {
        console.error('Error showing backup contents:', error);
        return [];
      }
    };
    
    // Emergency functions available in console for debugging
  }, []);

  useEffect(() => {
    if (!performanceDataReady || performanceSummaryLogged) {
      return;
    }

    measurePerformanceSegment('time-to-critical', 'start', 'critical-ready');
    measurePerformanceSegment('time-to-data', 'start', 'data-ready');
    measurePerformanceSegment('critical-to-data', 'critical-ready', 'data-ready');

    if (shouldAutoLogPerformance()) {
      logPerformanceSummary();
    }

    setPerformanceSummaryLogged(true);
  }, [performanceDataReady, performanceSummaryLogged]);

  const getSelectedSort = async () => {
    const { currentSortValue } = await browser.storage.local.get('currentSortValue');
    setSortValue(currentSortValue);
  }

  const getSelectedViewMode = async () => {
    const { collectionViewMode } = await browser.storage.local.get('collectionViewMode');
    setViewMode(collectionViewMode || 'list');
  }

  useEffect(() => {
    // Only load data if not already loaded and user is logged in
    if (isLoggedIn && !dataLoaded && !dataLoading) {
      loadCollectionsFromStorage();
    }
  }, [isLoggedIn, dataLoaded, dataLoading]);

  useEffect(() => {
    let isMounted = true;
    const timeouts = [];
    
    const initializeApp = async () => {
      // Initialize TimeAgo locale once for the entire app
      TimeAgo.addDefaultLocale(en);
      
      // Phase 2: Batch all initial storage reads
      const updateFlags = await loadInitialSettings();
      
      // Phase 3: Defer data loading until after initial render
      // This allows the popup window to open immediately
      const timeout1 = setTimeout(async () => {
        if (isMounted) {
          await loadCollectionsFromStorage(updateFlags);
        }
      }, 0);
      timeouts.push(timeout1);
      
      // Defer non-critical operations until after initial render
      const timeout2 = setTimeout(async () => {
        if (isMounted) {
          await removeInactiveWindowsFromAutoUpdate();
          // Phase 4: Defer sync check further - show UI first
          const timeout3 = setTimeout(async () => {
            if (isMounted) {
              await checkSyncStatus();
            }
          }, 1000);
          timeouts.push(timeout3);
        }
      }, 100);
      timeouts.push(timeout2);
    };
    
    initializeApp();
    
    // Cleanup function to prevent memory leaks
    return () => {
      isMounted = false;
      timeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, []); // Only run once on mount

  const escapeRegex = string => {
    return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  // Check if any filters are currently active
  const hasActiveFilters = useMemo(() => {
    const hasSearch = search && search.trim() !== '';
    const hasRecentlyOpenedFilter = filters.recentlyOpenedActual;
    const hasColorFilter = filters.color;
    
    return hasSearch || hasRecentlyOpenedFilter || hasColorFilter;
  }, [search, filters]);

  const collectionsToShow = useMemo(() => {
    if (!settingsData) return settingsData;
    
    let filteredCollections = [...settingsData];
    
    // Apply search filter
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      filteredCollections = filteredCollections.filter(collection => {
        // Search in collection name
        const nameMatch = collection.name.match(searchRegex);
        
        // Search in tab titles and URLs
        const tabMatch = collection.tabs && collection.tabs.some(tab => 
          tab.title?.match(searchRegex) || 
          tab.url?.match(searchRegex)
        );
        
        return nameMatch || tabMatch;
      });
    }
    
    // Apply recently opened filter (last 3 hours)
    if (filters.recentlyOpenedActual) {
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
              filteredCollections = filteredCollections.filter(collection => {
          return collection.lastOpened && collection.lastOpened >= threeHoursAgo;
        });
    }
    
    // Apply color filter
    if (filters.color) {
      filteredCollections = filteredCollections.filter(collection => {
        return collection.color === filters.color;
      });
    }
    
    
    return filteredCollections;
  }, [
    search,
    settingsData,
    filters,
  ]);

  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  // Cleanup effect to prevent memory leaks
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return <div className="App">
    <ReactTooltip
      event={'mouseover'}
      eventOff={'click mouseout'}
      delayShow={200}
      type={themeMode === 'light' ? 'dark' : 'light'}
      place="bottom"
      effect="solid"
      offset={{ top: 5 }} />
    <Header
      applyDataFromServer={applyDataFromServer}
      updateRemoteData={updateRemoteData}
      logout={logout} />
    <div className="main-content-wrapper">
              <AddNewTextbox addCollection={addCollection} addFolder={addFolder} updateRemoteData={updateRemoteData} onDataUpdate={refreshDataAfterFolderOperation} />
      <CollectionListOptions 
        key={`${sortValue}-select`}
        updateRemoteData={updateRemoteData} 
        selected={sortValue}
        addCollection={addCollection}
        addFolder={addFolder}
        onViewModeChange={setViewMode}
        onFiltersChange={handleFiltersChange}
      />
      <CollectionList
        key={`collection-list-${listKey}`}
        updateRemoteData={updateRemoteData}
        collections={collectionsToShow}
        folders={foldersData}
        updateCollection={updateCollection}
        removeCollection={removeCollection}
        addCollection={addCollection}
        onDataUpdate={refreshDataAfterFolderOperation}
        onFolderStateChange={updateSingleFolderInState}
        updateFolders={updateFolders}
        triggerSync={triggerSync}
        viewMode={viewMode}
        hasActiveFilters={hasActiveFilters}
        lightningEffectUid={lightningEffectUid}
        lightningEffectFolderUid={lightningEffectFolderUid}
        triggerFolderLightningEffect={triggerFolderLightningEffect} />
      <div className="bottom-fade-overlay"></div>
    </div>
    <Footer />
  </div>;
}

export default App;
