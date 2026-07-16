import './App.css';
import 'react-tooltip/dist/react-tooltip.css';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import Header from './Header';
import AddNewTextbox from './AddNewTextbox';
import CollectionList from './CollectionList';
import Footer from './Footer';
import FPLayout from './fullpage/FPLayout';
import CommandPalette from './CommandPalette';
import TabSwitcher from './TabSwitcher';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { highlightedCollectionUidState } from './atoms/animationsState';
import { commandPaletteOpenState } from './atoms/commandPaletteState';
import { aiToolsModalOpenState, aiToolsInitialToolState } from './atoms/aiState';
import { tabSwitcherOpenState } from './atoms/tabSwitcherState';
import { sidebarNavigationState } from './atoms/fullpageState';
import {
    settingsDataState,
    themeState,
    isLoggedInState,
    syncInProgressState,
    lastSyncTimeState,
    syncSessionStateState,
    searchState,
    listKeyState,
    trackingStateVersion,
    viewContextState,
    detailPanelOpenState,
} from './atoms/globalAppSettingsState';

import { browser } from '../static/globals';
import { filterByColors } from './utils/colorMigration';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import { showSuccessToast, showErrorToast, setToastViewContext } from './toastHelpers';
import { Tooltip } from 'react-tooltip';
import { CollectionListOptions } from './CollectionListOptions';

// New indexed storage utilities
import {
    loadAllCollections,
    loadMultipleCollections,
    saveSingleCollection,
    migrateLegacyStorage,
    getStorageStats as getNewStorageStats,
    batchUpdateCollections,
    loadCollectionsIndex,
    loadAllFolders,
    updateFoldersOrder,
    repairOrphanCollections,
    sortCollectionsForDisplay,
    STORAGE_KEYS,
    CURRENT_STORAGE_VERSION
} from './utils/storageUtils';
import { applyFolderCollapsedState, getFolderCollapseStorageKey } from './utils/folderViewState';
import { openOrFocusFullPageInCurrentWindow } from './utils/openFullPage';
import { openCollectionTabs } from './useCollectionOperations';

// Folder operations
import { createFolder } from './utils/folderOperations';

import useOrphanRecovery from './useOrphanRecovery';
import OrphanRecoveryModal from './OrphanRecoveryModal';
import { OrphanRecoveryContext } from './OrphanRecoveryContext';
import AIToolsModal from './AIToolsModal';
import ManageSubscriptionModal from './ManageSubscriptionModal';
import { manageSubscriptionOpenState } from './atoms/premiumState';
import { usePremiumEntitlement } from './usePremiumEntitlement';

// Migration system imports - wrapped in try/catch for compatibility
const PERF_NAMESPACE = 'tabox:popup';
const PERF_MEASURE_PREFIX = `${PERF_NAMESPACE}:measure:`;
const DEFAULT_COLLECTION_FILTERS = { recentlyOpenedActual: false, colors: [], favoritesOnly: false };

const makeMarkName = (label) => `${PERF_NAMESPACE}:${label}`;

const escapeSearchRegex = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const matchesCollectionSearch = (collection, search) => {
  if (!search || !search.trim()) {
    return true;
  }

  const searchRegex = new RegExp(escapeSearchRegex(search.trim()), 'i');

  return Boolean(
    collection?.name?.match(searchRegex) ||
    (collection?.tabs || []).some((tab) => (
      tab.title?.match(searchRegex) || tab.url?.match(searchRegex)
    ))
  );
};

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
const SYNC_SESSION_STATE_KEY = 'syncSessionState';
const DEFAULT_SYNC_SESSION_STATE = {
  isEnabled: false,
  status: 'disabled',
  user: null,
  hasRefreshToken: false,
  error: null,
  lastCheckedAt: 0
};

const normalizeSyncSessionState = (syncSessionState = {}) => ({
  ...DEFAULT_SYNC_SESSION_STATE,
  ...(syncSessionState || {})
});

const isSyncSessionEnabled = (syncSessionState = {}) => (
  Boolean(syncSessionState.isEnabled || syncSessionState.hasRefreshToken || syncSessionState.user)
);

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
let assessMigrationNeeds, executeMigration;
let timeAgoLocaleInitialized = false;
function App({ mode = 'popup' }) {
  const isFullPage = mode === 'fullpage';
  const [settingsData, setSettingsData] = useAtom(settingsDataState);
  const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
  const [themeMode, setThemeMode] = useAtom(themeState);
  const [isLoggedIn, setIsLoggedIn] = useAtom(isLoggedInState);
  const [, setSyncSessionState] = useAtom(syncSessionStateState);
  const setSyncInProgress = useSetAtom(syncInProgressState);
  const setLastSyncTime = useSetAtom(lastSyncTimeState);
  const setViewContext = useSetAtom(viewContextState);
  const isPanelOpen = useAtomValue(detailPanelOpenState);
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenState);
  const setAiToolsModalOpen = useSetAtom(aiToolsModalOpenState);
  const setAiToolsInitialTool = useSetAtom(aiToolsInitialToolState);
  const setManageSubscriptionOpen = useSetAtom(manageSubscriptionOpenState);
  const setTabSwitcherOpen = useSetAtom(tabSwitcherOpenState);
  const setSidebarNavigation = useSetAtom(sidebarNavigationState);
  const search = useAtomValue(searchState);
  const [listKey, setListKey] = useAtom(listKeyState);
  const [sortValue, setSortValue] = useState(null);
  const [viewMode, setViewMode] = useState(isFullPage ? 'grid' : 'list');
  const [filters, setFilters] = useState(DEFAULT_COLLECTION_FILTERS);
  
  // Global tracking state version - incremented when tracking changes
  const [, setTrackingVersion] = useAtom(trackingStateVersion);
  
  // Mount tracking to prevent memory leaks
  const isMountedRef = useRef(true);

  // Track if migration is currently running
  const [migrationInProgress, setMigrationInProgress] = useState(false);
  const [migrationChecked, setMigrationChecked] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [orphanScanReady, setOrphanScanReady] = useState(false);

  // Lightning effect state for folders when collections are dropped into them
  const [lightningEffectFolderUid, setLightningEffectFolderUid] = useState(null);

  // Storage performance tracking
  const [, setStorageStats] = useState(null);
  const [trackedCollectionUids, setTrackedCollectionUids] = useState(new Set());

  // Folders state management
  const [foldersData, setFoldersData] = useState([]);
  const [folderCollapsedState, setFolderCollapsedState] = useState({});
  const [performanceDataReady, setPerformanceDataReady] = useState(false);
  const [performanceSummaryLogged, setPerformanceSummaryLogged] = useState(false);
  const performanceMarksRef = useRef({ critical: false, data: false });
  const metadataUidOrderRef = useRef([]);
  const settingsDataRef = useRef([]);
  const dataLoadedRef = useRef(false);
  const storageReloadTimeoutRef = useRef(null);
  const folderCollapseStorageKey = getFolderCollapseStorageKey(isFullPage ? 'fullpage' : 'popup');

  useEffect(() => {
    settingsDataRef.current = settingsData || [];
  }, [settingsData]);

  useEffect(() => {
    dataLoadedRef.current = dataLoaded;
  }, [dataLoaded]);

  useEffect(() => {
    let isMounted = true;

    const loadFolderCollapsedState = async () => {
      try {
        const stored = await browser.storage.local.get(folderCollapseStorageKey);
        if (!isMounted) return;

        const nextState = stored?.[folderCollapseStorageKey];
        setFolderCollapsedState(
          nextState && typeof nextState === 'object' && !Array.isArray(nextState)
            ? nextState
            : {}
        );
      } catch (error) {
        console.error(`Error loading ${folderCollapseStorageKey}:`, error);
        if (isMounted) {
          setFolderCollapsedState({});
        }
      }
    };

    loadFolderCollapsedState();

    return () => {
      isMounted = false;
    };
  }, [folderCollapseStorageKey]);

  const getCurrentCollectionSortOptions = useCallback(async () => {
    const { currentSortValue, currentSortAscending } = await browser.storage.local.get(['currentSortValue', 'currentSortAscending']);
    const selectedSortValue = currentSortValue || 'DATE';
    const sortAscending = currentSortAscending !== undefined ? currentSortAscending : true;
    const sortFieldMap = { 'DATE': 'lastUpdated', 'NAME': 'name', 'COLOR': 'color' };

    return {
      sortBy: sortFieldMap[selectedSortValue] || 'lastUpdated',
      sortOrder: sortAscending ? 'asc' : 'desc'
    };
  }, []);

  const applyCollectionUpdates = useCallback(async (updatedCollectionsInput = []) => {
    const updatedCollections = updatedCollectionsInput.filter(Boolean);

    if (updatedCollections.length === 0 || !dataLoadedRef.current || settingsDataRef.current.length === 0) {
      return;
    }
    const { sortBy, sortOrder } = await getCurrentCollectionSortOptions();
    const updatedCollectionUids = new Set(updatedCollections.map(collection => collection.uid));

    setSettingsData(prevSettingsData => {
      const currentCollections = prevSettingsData || [];
      const unchangedCollections = currentCollections.filter(collection => !updatedCollectionUids.has(collection.uid));

      if (updatedCollections.length === 0 && unchangedCollections.length === currentCollections.length) {
        return currentCollections;
      }

      return sortCollectionsForDisplay(
        [...unchangedCollections, ...updatedCollections],
        { sortBy, sortOrder }
      );
    });
  }, [getCurrentCollectionSortOptions, setSettingsData]);

  const reloadCollectionsAndFoldersFromStorage = useCallback(async ({ updateSyncTime = false } = {}) => {
    try {
      const { sortBy, sortOrder } = await getCurrentCollectionSortOptions();
      const [collections, folders] = await Promise.all([
        loadAllCollections({ metadataOnly: false, sortBy, sortOrder }),
        loadAllFolders({ metadataOnly: false, sortBy: 'order', sortOrder: 'asc' })
      ]);

      setSettingsData(collections);
      setFoldersData(folders);

      if (updateSyncTime && isLoggedIn) {
        await refreshLastSyncTimeFromStorage({ fallbackToNow: true });
      }
    } catch (error) {
      console.error('Error reloading data from storage:', error);
    }
  }, [getCurrentCollectionSortOptions, isLoggedIn, refreshLastSyncTimeFromStorage, setSettingsData]);

  const scheduleStorageDrivenReload = useCallback(() => {
    if (!dataLoadedRef.current) {
      return;
    }

    if (storageReloadTimeoutRef.current) {
      clearTimeout(storageReloadTimeoutRef.current);
    }

    storageReloadTimeoutRef.current = setTimeout(() => {
      storageReloadTimeoutRef.current = null;
      reloadCollectionsAndFoldersFromStorage();
    }, 25);
  }, [reloadCollectionsAndFoldersFromStorage]);

  const loadTrackedCollectionUids = useCallback(async () => {
    const { chkEnableAutoUpdate, collectionsToTrack } = await browser.storage.local.get([
      'chkEnableAutoUpdate',
      'collectionsToTrack'
    ]);

    if (!chkEnableAutoUpdate) {
      setTrackedCollectionUids(new Set());
      return;
    }

    setTrackedCollectionUids(new Set((collectionsToTrack || []).map(item => item.collectionUid)));
  }, []);

  const refreshLastSyncTimeFromStorage = useCallback(async ({ fallbackToNow = false } = {}) => {
    const { lastSuccessfulSyncTime } = await browser.storage.local.get('lastSuccessfulSyncTime');

    if (lastSuccessfulSyncTime) {
      setLastSyncTime(lastSuccessfulSyncTime);
      return lastSuccessfulSyncTime;
    }

    if (fallbackToNow) {
      const now = Date.now();
      setLastSyncTime(now);
      return now;
    }

    setLastSyncTime(null);
    return null;
  }, [setLastSyncTime]);
  
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
      await import('./utils/dataValidation');

      assessMigrationNeeds = migrationModule.assessMigrationNeeds;
      executeMigration = migrationModule.executeMigration;
      
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

  const _handleSyncError = async () => {
    await browser.storage.local.remove('googleToken');
    await browser.storage.local.remove('googleUser');
    setSyncSessionState(normalizeSyncSessionState());
    setIsLoggedIn(false);
    showErrorToast('Error syncing data, please enable sync again');
  }

  const logout = async () => {
    browser.runtime.sendMessage({ type: 'logout' }).then(() => {
      setSyncSessionState(normalizeSyncSessionState());
      setIsLoggedIn(false);
    })
  };

  const applyDataFromServer = async (force = false) => {
    setSyncInProgress(true);
    console.log('🚀 applyDataFromServer: Starting, force=', force);
    browser.runtime.sendMessage({ type: 'loadFromServer', force: force }).then(async (response) => {
      console.log('🚀 applyDataFromServer: Got response from background:', response);
      if (response !== false) {
        // Use new storage system for server data
        
        const { sortBy, sortOrder } = await getCurrentCollectionSortOptions();
        
        console.log('📥 applyDataFromServer: Response type:', typeof response, 'Is array:', Array.isArray(response), 'Length:', response?.length);
        
        if (response && Array.isArray(response) && response.length > 0) {
          console.log('📥 applyDataFromServer: Saving', response.length, 'collections from server');
          const success = await batchUpdateCollections(response);
          if (success) {
            // Add a small delay to ensure storage writes are committed
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Reload both collections and folders from storage after sync
            const [updatedCollections, updatedFolders] = await Promise.all([
              loadAllCollections({ metadataOnly: false, sortBy, sortOrder }),
              loadAllFolders({ metadataOnly: false })
            ]);
            
            console.log('📥 applyDataFromServer: Loaded', updatedCollections.length, 'collections and', updatedFolders.length, 'folders from storage');
            console.log('📥 applyDataFromServer: Setting state with folders:', updatedFolders.map(f => f.name));
            
            setSettingsData(updatedCollections);
            setFoldersData(updatedFolders);
            await refreshLastSyncTimeFromStorage({ fallbackToNow: true });
          } else {
            console.error('❌ Failed to save server data');
          }
        } else if (response === 'no_update_needed') {
          // Sync says nothing changed - but still reload folders in case they were updated by background
          console.log('📥 applyDataFromServer: No update needed, but reloading folders anyway');
          const folders = await loadAllFolders({ metadataOnly: false });
          console.log('📥 applyDataFromServer: Loaded', folders.length, 'folders');
          setFoldersData(folders);
          await refreshLastSyncTimeFromStorage({ fallbackToNow: true });
        } else {
          // Server returned empty collections - still load folders from storage
          // (folders are saved by migrateIncomingSyncData in the background)
          console.log('📥 applyDataFromServer: Empty response, loading from storage');
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const [updatedCollections, updatedFolders] = await Promise.all([
            loadAllCollections({ metadataOnly: false, sortBy, sortOrder }),
            loadAllFolders({ metadataOnly: false })
          ]);
          
          console.log('📥 applyDataFromServer: Loaded', updatedCollections.length, 'collections and', updatedFolders.length, 'folders from storage');
          
          setSettingsData(updatedCollections);
          setFoldersData(updatedFolders);
          await refreshLastSyncTimeFromStorage({ fallbackToNow: true });
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
    browser.runtime.sendMessage({ type: 'updateRemote' }).then(async (response) => {
      if (response !== false) {
        await reloadCollectionsAndFoldersFromStorage({ updateSyncTime: true });
        return;
      }

      await refreshLastSyncTimeFromStorage({ fallbackToNow: false });
    }).catch(async (err) => {
      await _handleSyncError(err)
    }).finally(() => {
      setSyncInProgress(false);
    });
  }

  const checkSyncStatus = async () => {
    const {
      [SYNC_SESSION_STATE_KEY]: storedSyncSessionState,
      googleUser,
      googleRefreshToken
    } = await browser.storage.local.get([SYNC_SESSION_STATE_KEY, 'googleUser', 'googleRefreshToken']);
    const cachedSyncSessionState = normalizeSyncSessionState(
      storedSyncSessionState || {
        user: googleUser || null,
        hasRefreshToken: Boolean(googleRefreshToken),
        isEnabled: Boolean(googleUser || googleRefreshToken),
        status: googleRefreshToken ? 'auth_refreshing' : 'disabled',
        error: null,
        lastCheckedAt: 0
      }
    );

    if (isMountedRef.current) {
      setSyncSessionState(cachedSyncSessionState);
      setIsLoggedIn(isSyncSessionEnabled(cachedSyncSessionState));
    }
    
    // Then check actual status in background
    if (!cachedSyncSessionState.hasRefreshToken && !googleRefreshToken) return;
    
    browser.runtime.sendMessage({ type: 'checkSyncStatus' }).then(async (response) => {
      if (isMountedRef.current) {
        if (response === undefined) {
          return;
        }

        if (response === false) {
          const disabledState = normalizeSyncSessionState();
          setSyncSessionState(disabledState);
          setIsLoggedIn(false);
          return;
        }

        if (!response || typeof response !== 'object') {
          return;
        }

        const nextSyncSessionState = normalizeSyncSessionState({
          ...cachedSyncSessionState,
          user: response.displayName || response.emailAddress ? response : cachedSyncSessionState.user,
          hasRefreshToken: true,
          isEnabled: response.syncStatus !== 'disabled',
          status: response.syncStatus || 'active',
          error: response.syncError || null,
          lastCheckedAt: Date.now()
        });
        setSyncSessionState(nextSyncSessionState);
        setIsLoggedIn(isSyncSessionEnabled(nextSyncSessionState));
        if (response.syncStatus === 'active') await _update();
      }
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
        // Update local state using functional update to avoid stale closure issues
        // This ensures we always use the latest state, even with rapid consecutive updates
        setSettingsData(prevSettingsData => {
          const newList = [...prevSettingsData];
          const index = newList.findIndex(c => c.uid === newCollection.uid);
          if (index !== -1) {
            newList[index] = newCollection;
          }
          return newList;
        });
        
        // Highlight the updated collection instead of replaying the whole grid
        if (isManualUpdate) {
          setHighlightedCollectionUid(newCollection.uid);
        }
        
        // Continue with sync if logged in
        await browser.storage.local.set({ localTimestamp: Date.now() });
        await browser.runtime.sendMessage({ type: 'addCollection' });
        if (!isLoggedIn) return;
        _update();
      } else {
        console.error(`❌ Failed to update collection ${newCollection.uid}`);
        // Fallback to legacy full update - use functional update here too
        setSettingsData(prevSettingsData => {
          const newList = [...prevSettingsData];
          const index = newList.findIndex(c => c.uid === newCollection.uid);
          if (index !== -1) {
            newList[index] = newCollection;
          }
          return newList;
        });
        await updateRemoteData(settingsData.map(c => c.uid === newCollection.uid ? newCollection : c));
      }
    } catch (error) {
      console.error('Error updating collection:', error);
      // Fallback to legacy system - use functional update here too
      setSettingsData(prevSettingsData => {
        const newList = [...prevSettingsData];
        const index = newList.findIndex(c => c.uid === newCollection.uid);
        if (index !== -1) {
          newList[index] = newCollection;
        }
        return newList;
      });
      await updateRemoteData(settingsData.map(c => c.uid === newCollection.uid ? newCollection : c));
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
          } catch {
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
        
        showSuccessToast(`Folder "${newFolder.name}" created successfully`);
        
        // Update sync time in footer (sync is already fired by createFolder)
        if (isLoggedIn) {
          setLastSyncTime(Date.now());
        }
        
        return newFolder;
      } else {
        console.error(`❌ Failed to create folder: ${name}`);
        showErrorToast(`Failed to create folder`);
        return null;
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      showErrorToast(`Failed to create folder: ${error.message}`);
      return null;
    }
  };

  // Function to refresh both collections and folders data
  const refreshDataAfterFolderOperation = async () => {
    await reloadCollectionsAndFoldersFromStorage({ updateSyncTime: true });
  };

  // Enable orphan detection once migration has been checked — NOT on dataLoaded,
  // which never flips on some paths (e.g. the full-page view hydrated via sync).
  // A fallback timer guarantees detection still runs if no signal arrives, so it
  // can never be permanently blocked by a single data-load code path.
  useEffect(() => {
    if (migrationChecked || dataLoaded) {
      setOrphanScanReady(true);
      return undefined;
    }
    const fallback = setTimeout(() => setOrphanScanReady(true), 2000);
    return () => clearTimeout(fallback);
  }, [migrationChecked, dataLoaded]);

  usePremiumEntitlement();

  const orphanRecovery = useOrphanRecovery(orphanScanReady, {
    onRecovered: async (count) => {
      await refreshDataAfterFolderOperation();
      showSuccessToast(`Restored ${count} hidden collection${count === 1 ? '' : 's'}`);
    },
  });

  const applyOptimisticFolderUpdate = useCallback((folderUid, updates = {}) => {
    if (!folderUid || !updates || typeof updates !== 'object') {
      return;
    }

    setFoldersData((currentFolders) => currentFolders.map((folder) => (
      folder.uid === folderUid
        ? {
            ...folder,
            ...updates,
          }
        : folder
    )));
  }, []);
  
  const updateFolderCollapsedPreference = useCallback((updatedFolder) => {
    if (!updatedFolder?.uid) {
      return;
    }

    const nextCollapsed = !!updatedFolder.collapsed;

    setFolderCollapsedState((prevState) => {
      if (prevState[updatedFolder.uid] === nextCollapsed) {
        return prevState;
      }

      const nextState = {
        ...prevState,
        [updatedFolder.uid]: nextCollapsed,
      };

      browser.storage.local.set({
        [folderCollapseStorageKey]: nextState,
      }).catch((error) => {
        console.error(`Error saving ${folderCollapseStorageKey}:`, error);
      });

      return nextState;
    });
  }, [folderCollapseStorageKey]);

  const displayFolders = useMemo(() => {
    return applyFolderCollapsedState({
      folders: foldersData,
      collapsedState: folderCollapsedState,
      viewContext: isFullPage ? 'fullpage' : 'popup',
    });
  }, [folderCollapsedState, foldersData, isFullPage]);

  const hydrateCollectionsInBatches = useCallback(async (metadataList, startIndex = 0) => {
    if (!metadataList || metadataList.length === 0) {
      setDataLoaded(true);
      markDataHydrationComplete();
      return;
    }

    const metadataLookup = new Map(metadataList.map((item) => [item.uid, item]));
    let currentIndex = Math.max(startIndex, 0);
    const missingUids = [];

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

        for (const uid of chunkUids) {
          if (!chunkDataMap[uid]) {
            missingUids.push(uid);
          }
        }

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

    // Repair index-storage mismatches: remove orphan index entries that have
    // no backing collection_<uid> record so they don't silently hide data.
    if (missingUids.length > 0) {
      console.warn(`Hydration: ${missingUids.length} collection(s) in index but missing from storage — cleaning index`, missingUids);
      try {
        const index = await loadCollectionsIndex();
        let repaired = false;
        for (const uid of missingUids) {
          if (index[uid]) {
            delete index[uid];
            repaired = true;
          }
        }
        if (repaired) {
          await browser.storage.local.set({ [STORAGE_KEYS.COLLECTIONS_INDEX]: index });
        }
      } catch (repairError) {
        console.warn('Non-critical: index repair after hydration failed:', repairError);
      }
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
    // Declared outside the try so the catch block below can still read it.
    let extensionUpdated = false;

    try {
      // Check for extension updates and run migrations safely
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
          showSuccessToast(`Upgraded storage system for ${storageeMigrationResult.count} collections - faster performance!`);
        } else if (storageeMigrationResult.unsupportedPre40) {
          showErrorToast('Automatic migration is now limited to 4.0+ local data. Your older local data was left untouched.');
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
                showSuccessToast(`Migrating ${migrationAssessment.collections} collections to new format...`);
              }
              
              // Execute migration (emergency backup is handled internally now)
              const migrationResult = await executeMigration();
              
              if (migrationResult.success && !migrationResult.skipped) {
                showSuccessToast('Extension updated and data migrated successfully!');
              } else if (migrationResult.skipped) {
                showSuccessToast('Extension updated successfully');
              } else {
                console.error('❌ Data migration failed:', migrationResult.error);
                showErrorToast('Extension updated but data migration failed - your data has been preserved');
              }
            } finally {
              setMigrationInProgress(false);
            }
          } else {
            showSuccessToast('Extension updated successfully');
          }
        } else {
          showSuccessToast(`Extension updated from ${previousVersion} - data loading in compatibility mode`);
        }
      }

      await loadDataWithNewSystem();
      
    } catch (migrationError) {
      console.error('❌ Migration check/execution failed:', migrationError);
      if (extensionUpdated) {
        showErrorToast(`Extension updated but migration failed - continuing with existing data`);
      } else {
        showErrorToast('Migration check failed - extension will continue with existing data');
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
      const { sortBy, sortOrder } = await getCurrentCollectionSortOptions();
      
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
      
      // Run orphan collection repair in the background (non-blocking)
      // This fixes collections that have parentId pointing to non-existent folders,
      // which can happen due to sync issues or folder deletion without proper cleanup.
      // The UI already shows orphans at root level, this just cleans up the underlying data.
      repairOrphanCollections().then(result => {
        if (result.orphansRepaired > 0) {
          console.log(`🔧 Repaired ${result.orphansRepaired} orphan collection(s) - they are now visible at root level`);
        }
        if (result.ghostsPruned > 0) {
          console.log(`🔧 Pruned ${result.ghostsPruned} stale index entr(ies) with no backing storage`);
        }
      }).catch(err => {
        console.warn('Non-critical: orphan repair failed:', err);
      });
      
    } catch (error) {
      console.error('❌ Failed to load data with new system, falling back to legacy:', error);
      await loadDataLegacy();
    }
  };

  // Legacy data loading (fallback)
  const loadDataLegacy = async () => {
    // Try to load folders from indexed storage even in legacy mode
    let legacyFolders = [];
    try {
      legacyFolders = await loadAllFolders({ metadataOnly: false });
    } catch (folderError) {
      console.warn('Could not load folders in legacy fallback:', folderError);
    }
    const hasFolders = legacyFolders.length > 0;
    const folderUids = new Set(legacyFolders.map(f => f.uid));

    const { [STORAGE_KEYS.LEGACY_TABS_ARRAY]: tabsArray } = await browser.storage.local.get(STORAGE_KEYS.LEGACY_TABS_ARRAY);
    let newCollections = [];
    
    if (tabsArray && tabsArray.length > 0) {
      const cleanedCollections = [];
      const seenUids = new Set();
      
      tabsArray.forEach((collection) => {
        if (!collection.uid || seenUids.has(collection.uid)) {
          console.warn('Skipping duplicate or invalid collection:', collection.uid);
          return;
        }
        
        if (collection.type === 'folder') {
          console.warn('Skipping folder item in tabsArray:', collection.uid);
          return;
        }

        const cleanedCollection = { ...collection, type: 'collection' };
        // Preserve parentId when the referenced folder actually exists
        if (cleanedCollection.parentId && !hasFolders) {
          delete cleanedCollection.parentId;
        } else if (cleanedCollection.parentId && !folderUids.has(cleanedCollection.parentId)) {
          delete cleanedCollection.parentId;
        }
        
        seenUids.add(collection.uid);
        cleanedCollections.push(cleanedCollection);
      });
      
      newCollections = cleanedCollections;
    }
    
    setSettingsData(newCollections);
    setFoldersData(legacyFolders);
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
    } catch {
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
      
      showSuccessToast('Emergency cleanup completed - freed storage space');
      
      // Update storage stats
      const newStats = await getNewStorageStats();
      setStorageStats(newStats);
      
      return true;
    } catch (error) {
      console.error('Emergency storage cleanup failed:', error);
      showErrorToast('Emergency cleanup failed: ' + error.message);
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
        showSuccessToast('Emergency recovery completed - data restored from backup');
      } else {
        showErrorToast('Emergency recovery failed - no valid backups available');
      }
    } catch (error) {
      console.error('💥 EMERGENCY RECOVERY: Failed:', error);
      showErrorToast('Emergency recovery failed - migration system not available');
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
      await loadAllCollections({ metadataOnly: false, limit: 10 });
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
      if (!timeAgoLocaleInitialized) {
        TimeAgo.addDefaultLocale(en);
        timeAgoLocaleInitialized = true;
      }
      
      // Phase 2: Batch all initial storage reads
      const updateFlags = await loadInitialSettings();
      await refreshLastSyncTimeFromStorage();
      await loadTrackedCollectionUids();
      
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
          }, isFullPage ? 1000 : 0);
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
  }, [loadTrackedCollectionUids, refreshLastSyncTimeFromStorage]); // Only run once on mount

  // PERFORMANCE FIX: Single global storage listener for tracking changes
  // This replaces individual listeners in every collection/folder component
  // Reduces 50+ listeners to just 1 listener
  useEffect(() => {
    const handleStorageChange = async (changes, areaName) => {
      try {
        if (areaName !== 'local') {
          return;
        }

        const changedKeys = Object.keys(changes);
        const syncDataChanged = changedKeys.some((key) => (
          key === STORAGE_KEYS.COLLECTIONS_INDEX ||
          key === STORAGE_KEYS.FOLDERS_INDEX ||
          key.startsWith(STORAGE_KEYS.COLLECTION_PREFIX) ||
          key.startsWith(STORAGE_KEYS.FOLDER_PREFIX)
        ));

        if (syncDataChanged) {
          scheduleStorageDrivenReload();
        }

        if (changes.theme) {
          const newTheme = changes.theme.newValue || 'light';
          setThemeMode(newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
        }

        if (changes.lastSuccessfulSyncTime) {
          setLastSyncTime(changes.lastSuccessfulSyncTime.newValue || null);
        }

        if (changes[SYNC_SESSION_STATE_KEY]) {
          const nextSyncSessionState = normalizeSyncSessionState(changes[SYNC_SESSION_STATE_KEY].newValue);
          setSyncSessionState(nextSyncSessionState);
          setIsLoggedIn(isSyncSessionEnabled(nextSyncSessionState));
        } else if (changes.googleUser || changes.googleRefreshToken) {
          const nextGoogleUser = changes.googleUser
            ? changes.googleUser.newValue
            : (await browser.storage.local.get('googleUser')).googleUser;
          const nextGoogleRefreshToken = changes.googleRefreshToken
            ? changes.googleRefreshToken.newValue
            : (await browser.storage.local.get('googleRefreshToken')).googleRefreshToken;
          const currentStoredSyncSessionState = normalizeSyncSessionState(
            (await browser.storage.local.get(SYNC_SESSION_STATE_KEY))[SYNC_SESSION_STATE_KEY]
          );
          const nextSyncSessionState = normalizeSyncSessionState({
            ...currentStoredSyncSessionState,
            user: nextGoogleUser || currentStoredSyncSessionState.user,
            hasRefreshToken: Boolean(nextGoogleRefreshToken),
            isEnabled: Boolean(nextGoogleUser || nextGoogleRefreshToken || currentStoredSyncSessionState.isEnabled),
            status: nextGoogleUser || nextGoogleRefreshToken ? currentStoredSyncSessionState.status : 'disabled'
          });
          setSyncSessionState(nextSyncSessionState);
          setIsLoggedIn(isSyncSessionEnabled(nextSyncSessionState));
        }

        if (changes.collectionsToTrack || changes.chkEnableAutoUpdate) {
          const trackingEnabled = changes.chkEnableAutoUpdate
            ? Boolean(changes.chkEnableAutoUpdate.newValue)
            : Boolean((await browser.storage.local.get('chkEnableAutoUpdate')).chkEnableAutoUpdate);
          const trackedEntries = changes.collectionsToTrack
            ? (changes.collectionsToTrack.newValue || [])
            : (await browser.storage.local.get('collectionsToTrack')).collectionsToTrack || [];

          setTrackedCollectionUids(
            trackingEnabled
              ? new Set(trackedEntries.map(item => item.collectionUid))
              : new Set()
          );

          // Increment version to trigger re-checks in child components
          setTrackingVersion(prev => prev + 1);
        }
      } catch (error) {
        console.error('Error handling storage change:', error);
      }
    };
    
    browser.storage.onChanged.addListener(handleStorageChange);
    
    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [scheduleStorageDrivenReload, setIsLoggedIn, setLastSyncTime, setTrackingVersion]); // Only app-level listener, uses refs for latest data

  useEffect(() => {
    const handleRuntimeMessage = (request) => {
      // Only handle our own message type. We must return `undefined`
      // synchronously for everything else: webextension-polyfill treats any
      // returned Promise as "I will respond" and sends back `undefined`. Since
      // this listener runs in every open extension page, an async listener
      // would respond `undefined` to foreign messages (e.g. importData) and,
      // when a full-page tab is open while importing from the popup, that stray
      // response wins the race against the background's real result — causing
      // the popup import to resolve to `null` ("Import failed").
      if (request?.type !== 'collectionAutoUpdated' || !request.collection) {
        return undefined;
      }

      // Fire-and-forget: we don't send a response, so don't return a Promise.
      applyCollectionUpdates([request.collection]).catch((error) => {
        console.error('Error handling runtime collection update:', error);
      });
      return undefined;
    };

    browser.runtime.onMessage.addListener(handleRuntimeMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [applyCollectionUpdates]);

  // Check if any filters are currently active
  const hasActiveFilters = useMemo(() => {
    const hasSearch = search && search.trim() !== '';
    const hasRecentlyOpenedFilter = filters.recentlyOpenedActual;
    const hasColorFilter = filters.colors && filters.colors.length > 0;
    const hasFavoritesFilter = filters.favoritesOnly === true;

    return hasSearch || hasRecentlyOpenedFilter || hasColorFilter || hasFavoritesFilter;
  }, [search, filters]);

  const collectionsToShow = useMemo(() => {
    if (!settingsData) return settingsData;
    
    let filteredCollections = [...settingsData];
    
    // Apply search filter
    if (search && search.trim() !== '') {
      filteredCollections = filteredCollections.filter((collection) => matchesCollectionSearch(collection, search));
    }
    
    // Apply recently opened filter (last 3 hours)
    if (filters.recentlyOpenedActual) {
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
              filteredCollections = filteredCollections.filter(collection => {
          return collection.lastOpened && collection.lastOpened >= threeHoursAgo;
        });
    }
    
    // Apply color filter (multi-select, OR semantics)
    filteredCollections = filterByColors(filteredCollections, filters.colors);

    // Apply favorites filter
    if (filters.favoritesOnly) {
      filteredCollections = filteredCollections.filter(collection => collection.isFavorite === true);
    }

    return filteredCollections;
  }, [
    search,
    settingsData,
    filters,
  ]);

  const handleFiltersChange = useCallback((newFilters) => {
    setFilters({
      ...DEFAULT_COLLECTION_FILTERS,
      ...newFilters,
    });
  }, []);

  // Cleanup effect to prevent memory leaks
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (storageReloadTimeoutRef.current) {
        clearTimeout(storageReloadTimeoutRef.current);
        storageReloadTimeoutRef.current = null;
      }
    };
  }, []);

  // Set up fullpage mode class and view context
  useEffect(() => {
    if (isFullPage) {
      document.documentElement.classList.add('fullpage-mode');
      setViewContext('fullpage');
      setToastViewContext('fullpage');
    }
    return () => {
      document.documentElement.classList.remove('fullpage-mode');
    };
  }, [isFullPage, setViewContext]);

  // Command Palette (Cmd/Ctrl+K) and Tab Switcher (Cmd/Ctrl+Shift+S) shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        setTabSwitcherOpen(false);
        setCommandPaletteOpen(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setCommandPaletteOpen(false);
        setTabSwitcherOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen, setTabSwitcherOpen]);

  // Build folder name lookup map for command palette hints
  const folderNameMap = useMemo(() => {
    const map = {};
    (foldersData || []).forEach(f => { map[f.uid] = f.name; });
    return map;
  }, [foldersData]);

  // Command palette action handlers
  const cmdCreateFolder = useCallback(() => {
    const event = new CustomEvent('tabox:open-create-folder');
    window.dispatchEvent(event);
  }, []);

  const cmdImport = useCallback(() => {
    const event = new CustomEvent('tabox:open-import');
    window.dispatchEvent(event);
  }, []);

  const cmdExportAll = useCallback(async () => {
    try {
      const { downloadTextFile } = await import('./utils');
      const collections = await loadAllCollections();
      const folders = await loadAllFolders();
      const exportData = {
        type: 'full_export',
        collections,
        folders,
        exportedAt: new Date().toISOString(),
        version: '2.0',
        stats: {
          totalCollections: collections.length,
          totalFolders: folders.length,
          collectionsInFolders: collections.filter(c => c.parentId).length,
          rootCollections: collections.filter(c => !c.parentId).length
        }
      };
      downloadTextFile(JSON.stringify(exportData, null, 2), `tabox-full-export-${Date.now()}`);
    } catch (error) {
      console.error('Error exporting all data:', error);
      showErrorToast('Export failed');
    }
  }, []);

  const cmdOpenFullPage = useCallback(async () => {
    await openOrFocusFullPageInCurrentWindow();
    window.close();
  }, []);

  const cmdRestoreSession = useCallback(() => {
    if (isFullPage) {
      setSidebarNavigation('sessions');
    } else {
      const event = new CustomEvent('tabox:open-restore-session');
      window.dispatchEvent(event);
    }
  }, [isFullPage, setSidebarNavigation]);

  const cmdOpenAiTool = useCallback((toolId) => {
    setAiToolsInitialTool(toolId);
    setAiToolsModalOpen(true);
  }, [setAiToolsInitialTool, setAiToolsModalOpen]);

  const cmdManageSubscription = useCallback(() => {
    setManageSubscriptionOpen(true);
  }, [setManageSubscriptionOpen]);

  const cmdCollectionAction = useCallback(async (collection, actionId, payload) => {
    switch (actionId) {
      case 'open': {
        await openCollectionTabs({
          collectionToOpen: collection,
          updateCollection
        });
        break;
      }
      case 'rename': {
        const newName = payload?.newName;
        if (!newName || newName === collection.name) break;
        const updated = { ...collection, name: newName };
        await updateCollection(updated);
        showSuccessToast(`Renamed to "${newName}"`);
        break;
      }
      case 'move': {
        const { moveCollectionToFolder, removeCollectionFromFolder } = await import('./utils/folderOperations');
        const targetFolderId = payload?.targetFolderId;
        let success;
        if (targetFolderId === null) {
          success = await removeCollectionFromFolder(collection.uid);
        } else {
          success = await moveCollectionToFolder(collection.uid, targetFolderId);
        }
        if (success) {
          await refreshDataAfterFolderOperation();
          const targetName = targetFolderId === null ? 'root' : (folderNameMap[targetFolderId] || 'folder');
          showSuccessToast(`Moved "${collection.name}" to ${targetName}`);
        } else {
          showErrorToast('Failed to move collection');
        }
        break;
      }
      case 'duplicate': {
        const { generateCopyName, applyUid } = await import('./utils');
        const TaboxCollection = (await import('./model/TaboxCollection')).default;
        const allCollections = await loadAllCollections();
        const newName = generateCopyName(collection.name, allCollections);
        const copy = new TaboxCollection(
          newName,
          JSON.parse(JSON.stringify(collection.tabs || [])),
          collection.chromeGroups ? JSON.parse(JSON.stringify(collection.chromeGroups)) : [],
          collection.color,
          null,
          collection.window,
          null,
          null
        );
        const copiedCollection = applyUid(copy);
        copiedCollection.parentId = collection.parentId;
        await addCollection(copiedCollection);
        showSuccessToast(`Duplicated as "${newName}"`);
        break;
      }
      case 'export': {
        const { downloadTextFile } = await import('./utils');
        downloadTextFile(JSON.stringify(collection, null, 2), collection.name);
        break;
      }
      case 'delete': {
        const { deleteSingleCollection, updateFolderCollectionCount } = await import('./utils/storageUtils');
        const parentFolderId = collection.parentId;
        await deleteSingleCollection(collection.uid);
        const freshCollections = await loadAllCollections();
        await updateRemoteData(freshCollections);
        if (parentFolderId) {
          await updateFolderCollectionCount(parentFolderId);
          await refreshDataAfterFolderOperation();
        }
        showSuccessToast(`Deleted "${collection.name}"`);
        break;
      }
    }
  }, [addCollection, updateCollection, updateRemoteData, refreshDataAfterFolderOperation, folderNameMap]);

  const tooltipPortal = ReactDOM.createPortal(
    <Tooltip
      id="main-tooltip"
      delayShow={200}
      variant={themeMode === 'dark' ? 'dark' : 'light'}
      place="bottom"
      style={{ zIndex: 2147483647, whiteSpace: 'pre-line' }}
    />,
    document.body
  );

  const commandPaletteEl = (
    <CommandPalette
      collections={settingsData}
      folders={foldersData}
      folderNameMap={folderNameMap}
      onCreateFolder={cmdCreateFolder}
      onImport={cmdImport}
      onExportAll={cmdExportAll}
      onOpenFullPage={cmdOpenFullPage}
      onRestoreSession={cmdRestoreSession}
      onCollectionAction={cmdCollectionAction}
      onOpenAiTool={cmdOpenAiTool}
      onManageSubscription={cmdManageSubscription}
    />
  );

  const tabSwitcherEl = <TabSwitcher />;
  const aiToolsModalEl = <AIToolsModal updateRemoteData={updateRemoteData} />;
  const manageSubscriptionModalEl = <ManageSubscriptionModal />;

  if (isFullPage) {
    return <>
      <OrphanRecoveryContext.Provider value={orphanRecovery}>
        <OrphanRecoveryModal
          isOpen={orphanRecovery.showModal}
          orphans={orphanRecovery.orphans}
          busy={orphanRecovery.busy}
          onRestoreAll={() => orphanRecovery.recover()}
          onRestoreSelected={(uids) => orphanRecovery.recover(uids)}
          onDismiss={() => orphanRecovery.dismiss()}
        />
        {tooltipPortal}
        {commandPaletteEl}
        {tabSwitcherEl}
        {aiToolsModalEl}
        {manageSubscriptionModalEl}
        <FPLayout
          folders={displayFolders}
          collections={collectionsToShow}
          allCollections={settingsData}
          logout={logout}
          applyDataFromServer={applyDataFromServer}
          updateRemoteData={updateRemoteData}
          addCollection={addCollection}
          removeCollection={removeCollection}
          updateCollection={updateCollection}
          addFolder={addFolder}
          onFolderOptimisticUpdate={applyOptimisticFolderUpdate}
          onDataUpdate={refreshDataAfterFolderOperation}
          onFolderStateChange={updateFolderCollapsedPreference}
          updateFolders={updateFolders}
          triggerSync={triggerSync}
          viewMode={viewMode}
          sortValue={sortValue}
          onViewModeChange={setViewMode}
          onFiltersChange={handleFiltersChange}
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          lightningEffectFolderUid={lightningEffectFolderUid}
          triggerFolderLightningEffect={triggerFolderLightningEffect}
          trackedCollectionUids={trackedCollectionUids}
          listKey={listKey}
        />
      </OrphanRecoveryContext.Provider>
    </>;
  }

  return <>
    <OrphanRecoveryContext.Provider value={orphanRecovery}>
      <OrphanRecoveryModal
        isOpen={orphanRecovery.showModal}
        orphans={orphanRecovery.orphans}
        busy={orphanRecovery.busy}
        onRestoreAll={() => orphanRecovery.recover()}
        onRestoreSelected={(uids) => orphanRecovery.recover(uids)}
        onDismiss={() => orphanRecovery.dismiss()}
      />
      {tooltipPortal}
      {commandPaletteEl}
      {tabSwitcherEl}
      {aiToolsModalEl}
      {manageSubscriptionModalEl}
      <div className={`App${isFullPage ? ' fullpage' : ''}`}>
      <Header
        isFullPage={isFullPage}
        applyDataFromServer={applyDataFromServer}
        updateRemoteData={updateRemoteData}
        onDataUpdate={refreshDataAfterFolderOperation}
        addCollection={addCollection}
        logout={logout} />
      <div className={`main-content-wrapper${isFullPage && isPanelOpen ? ' panel-open' : ''}`}>
                <AddNewTextbox addCollection={addCollection} addFolder={addFolder} updateRemoteData={updateRemoteData} onDataUpdate={refreshDataAfterFolderOperation} />
        <CollectionListOptions
          key={`${sortValue}-select`}
          updateRemoteData={updateRemoteData}
          selected={sortValue}
          addCollection={addCollection}
          addFolder={addFolder}
          onViewModeChange={setViewMode}
          onFiltersChange={handleFiltersChange}
          onDataUpdate={refreshDataAfterFolderOperation}
        />
        <CollectionList
          key={`collection-list-${listKey}`}
          isFullPage={isFullPage}
          updateRemoteData={updateRemoteData}
          collections={collectionsToShow}
          folders={displayFolders}
          updateCollection={updateCollection}
          removeCollection={removeCollection}
          addCollection={addCollection}
          onDataUpdate={refreshDataAfterFolderOperation}
          onFolderStateChange={updateFolderCollapsedPreference}
          updateFolders={updateFolders}
          triggerSync={triggerSync}
          viewMode={viewMode}
          hasActiveFilters={hasActiveFilters}
          lightningEffectFolderUid={lightningEffectFolderUid}
          triggerFolderLightningEffect={triggerFolderLightningEffect} />
        <div className="bottom-fade-overlay"></div>
      </div>
      <Footer />
    </div>
    </OrphanRecoveryContext.Provider>
  </>;
}

export {
  DEFAULT_SYNC_SESSION_STATE,
  escapeSearchRegex,
  matchesCollectionSearch,
  markPerformancePoint,
  measurePerformanceSegment,
  logPerformanceSummary,
  shouldAutoLogPerformance,
  normalizeSyncSessionState,
  isSyncSessionEnabled,
  runWhenIdle,
  hasSessionMigrationCheck,
  markSessionMigrationComplete,
  shouldExposeDebugUtilities,
};

export default App;
