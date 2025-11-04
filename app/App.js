/* eslint-disable no-useless-escape */
import './App.css';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
    loadSingleCollection,
    saveSingleCollection,
    deleteSingleCollection,
    migrateLegacyStorage,
    getStorageStats as getNewStorageStats,
    batchUpdateCollections,
    loadCollectionsIndex,
    loadAllFolders,
    updateFoldersOrder
} from './utils/storageUtils';

// Folder operations
import { createFolder } from './utils/folderOperations';

// Migration system imports - wrapped in try/catch for compatibility
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
  
  // Update folders with proper order persistence
  const updateFolders = async (newFolders) => {
    try {
      console.log('📁 App.js: updateFolders called with:', newFolders.length, 'folders');
      
      // Update local state immediately for responsive UI
      setFoldersData(newFolders);
      console.log('✅ App.js: Local state updated');
      
      // Persist the new order to storage
      console.log('💾 App.js: Persisting to storage...');
      const success = await updateFoldersOrder(newFolders);
      
      if (!success) {
        console.error('❌ App.js: Failed to save folder order, reverting...');
        // Revert to original order on failure
        await refreshDataAfterFolderOperation();
      } else {
        console.log('✅ App.js: Successfully persisted folder order');
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
      console.log('🔧 Initializing migration system...');
      
      // Check if we're in browser extension context
      if (!browser || !browser.storage) {
        console.log('📱 Not in browser extension context - migration system not available');
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
      console.log('✅ Migration system initialized successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize migration system:', error);
      console.log('🔄 Continuing with legacy data loading...');
      return false;
    }
  };

  const removeInactiveWindowsFromAutoUpdate = async () => {
    let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
    if (!collectionsToTrack || collectionsToTrack.length === 0 || !chkEnableAutoUpdate) { return; }
    const activeWindowIds = (await browser.windows.getAll({ populate: false })).map(c => c.id);
    collectionsToTrack = collectionsToTrack.filter(c => activeWindowIds.includes(c.windowId));
    console.log('collectionsToTrack', collectionsToTrack);
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }

  const applyTheme = async () => {
    let { theme } = await browser.storage.local.get('theme');
    theme = theme ? theme : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setThemeMode(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  const checkSyncStatus = async () => {
    console.log('check sync status')
    const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
    if (!googleRefreshToken) return;
    browser.runtime.sendMessage({ type: 'checkSyncStatus' }).then(async (response) => {
      setIsLoggedIn(response === null ? false : response);
      if (response) await applyDataFromServer();
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
        console.log('📡 Applying server data using new storage system...');
        
        // Convert server data to new format and save using batch update
        console.log('📡 Response from server:', { type: typeof response, isArray: Array.isArray(response), length: response?.length, response });
        
        if (response && Array.isArray(response) && response.length > 0) {
          const success = await batchUpdateCollections(response);
          if (success) {
            setSettingsData(response);
            setLastSyncTime(Date.now());
            console.log('✅ Server data applied successfully');
          } else {
            console.error('❌ Failed to save server data');
          }
        } else if (response === 'no_update_needed') {
          console.log('📡 No server update needed - data already in sync');
          setLastSyncTime(Date.now());
        } else {
          console.log('📡 Empty or invalid server response, setting empty data');
          setSettingsData([]);
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
        
        console.log(`✅ Collection ${newCollection.uid} updated successfully`);
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
    console.log(`🔄 Adding new collection ${newCollection.uid}...`);
    
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
        
        console.log(`✅ Collection ${newCollection.uid} added successfully`);
      } else {
        console.error(`❌ Failed to add collection ${newCollection.uid}`);
        // Fallback to legacy system
        if (!skipStateUpdate) {
          const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
          setHighlightedCollectionUid(newCollection.uid);
          await updateRemoteData(newList);
        }
      }
      
      // Auto-update tracking logic (unchanged)
      const { chkAutoUpdateOnNewCollection } = await browser.storage.local.get('chkAutoUpdateOnNewCollection');
      if (!chkAutoUpdateOnNewCollection) return;
      setTimeout(async () => {
        let { collectionsToTrack } = (await browser.storage.local.get('collectionsToTrack')) || [];
        let window;
        try {
          window = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
        } catch (error) {
          console.log('Failed to get last focused window for auto-update tracking:', error.message);
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
      
    } catch (error) {
      console.error('Error adding collection:', error);
      // Fallback to legacy system
      const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
      setHighlightedCollectionUid(newCollection.uid);
      await updateRemoteData(newList);
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
        
        console.log(`✅ Folder ${newFolder.uid} created successfully`);
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
      // Reload both collections and folders to reflect changes
      const [collections, folders] = await Promise.all([
        loadAllCollections({ metadataOnly: false }),
        loadAllFolders({ metadataOnly: false })
      ]);
      
      setSettingsData(collections);
      setFoldersData(folders);
      
      console.log(`🔄 Data refreshed: ${collections.length} collections, ${folders.length} folders`);
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  // Updated to use new storage system with performance improvements
  const loadCollectionsFromStorage = async () => {
    // Prevent multiple simultaneous loads
    if (dataLoading) {
      console.log('⏳ Data loading already in progress, skipping...');
      return;
    }
    
    if (dataLoaded && settingsData?.length > 0) {
      console.log('✅ Data already loaded, skipping...');
      return;
    }
    
    setDataLoading(true);
    
    try {
      // Check for extension updates and run migrations safely
      let extensionUpdated = false;
      let previousVersion = null;
      
      // Prevent duplicate migration checks
      if (migrationChecked) {
        await loadDataWithNewSystem();
        return;
      }
      
      // Quick check for extension updates - batch storage reads
      const updateData = await browser.storage.local.get([
        'extensionUpdated', 'previousVersion', 'updateTimestamp'
      ]);
      
      extensionUpdated = updateData.extensionUpdated;
      previousVersion = updateData.previousVersion;
      
      if (extensionUpdated) {
        console.log(`🔄 Extension was updated from ${previousVersion} - running post-update migration check`);
        
        // Clear the update flag
        await browser.storage.local.remove(['extensionUpdated', 'updateTimestamp', 'previousVersion']);
      }
      
      // Mark migration as checked
      setMigrationChecked(true);
      
      // Check if migration is already running
      if (migrationInProgress) {
        console.log('⏳ Migration already in progress, skipping data loading...');
        return;
      }

      // Run storage system migration first (this is separate from data migrations)
      console.log('🚀 Starting storage system migration to indexed format...');
      const storageeMigrationResult = await migrateLegacyStorage();
      
      if (storageeMigrationResult.success && storageeMigrationResult.migrated) {
        console.log(`✅ Storage migration completed for ${storageeMigrationResult.count} collections`);
        openSuccessSnackbar(`Upgraded storage system for ${storageeMigrationResult.count} collections - faster performance!`);
      } else if (storageeMigrationResult.success) {
        console.log('✅ Storage system already up to date');
      } else {
        console.warn('⚠️ Storage migration failed, using legacy system');
      }

      // Only run data migration during extension updates
      if (extensionUpdated) {
        console.log('🔄 Extension update detected - running data migration system...');
        
        // Try to initialize data migration system
        const migrationReady = await initializeMigrationSystem();
        
        if (migrationReady && migrationSystemAvailable) {
          // Check for needed data migrations
          const migrationAssessment = await assessMigrationNeeds();
          
          if (migrationAssessment.migrationNeeded) {
            console.log('🚀 Data migration needed, executing...', migrationAssessment);
            
            setMigrationInProgress(true);
            
            try {
              // Show user feedback for migration
              if (migrationAssessment.collections > 10) {
                openSuccessSnackbar(`Migrating ${migrationAssessment.collections} collections to new format...`);
              }
              
              // Execute migration (emergency backup is handled internally now)
              const migrationResult = await executeMigration();
              
              if (migrationResult.success && !migrationResult.skipped) {
                console.log('✅ Data migration completed successfully');
                openSuccessSnackbar('Extension updated and data migrated successfully!');
              } else if (migrationResult.skipped) {
                console.log('⏭️ Data migration was skipped (already completed or in progress)');
                openSuccessSnackbar('Extension updated successfully');
              } else {
                console.error('❌ Data migration failed:', migrationResult.error);
                openErrorSnackbar('Extension updated but data migration failed - your data has been preserved');
              }
            } finally {
              setMigrationInProgress(false);
            }
          } else {
            console.log('✅ Extension updated - no data migration required');
            openSuccessSnackbar('Extension updated successfully');
          }
        } else {
          console.log('⚠️ Data migration system not available - using legacy data loading');
          openSuccessSnackbar(`Extension updated from ${previousVersion} - data loading in compatibility mode`);
        }
      } else {
        console.log('✅ Regular app startup - no data migration needed');
        await loadDataWithNewSystem();
      }
      
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
      // Load both collections and folders in parallel
      const [collections, folders] = await Promise.all([
        loadAllCollections({
          metadataOnly: false,
          sortBy: 'lastUpdated',
          sortOrder: 'desc'
        }),
        loadAllFolders({
          metadataOnly: false,
          sortBy: 'order',
          sortOrder: 'asc'
        })
      ]);
      
      // Set data immediately - all collections have UIDs since v3
      setSettingsData(collections);
      setFoldersData(folders);
      setDataLoaded(true);
      

      
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
    console.log('📄 Loading collections using legacy storage system...');
    
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
        delete cleanedCollection.parentFolderId;
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
        console.log('Cleaned up collections from', tabsArray.length, 'to', cleanedCollections.length);
        await browser.storage.local.set({ tabsArray: cleanedCollections });
        
        // Also clear any folder storage
        await browser.storage.local.remove('foldersArray');
      }
      
      newCollections = cleanedCollections;
    }
    
    setSettingsData(newCollections);
    console.log(`✅ Loaded ${newCollections.length} collections using legacy storage`);
  };

  // Emergency cleanup function - updated to work with new system
  const emergencyCleanup = async () => {
    console.log('EMERGENCY CLEANUP: Removing all folder data and fixing collections...');
    
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
          delete cleaned.parentFolderId;
          cleaned.type = 'collection';
          cleanedCollections.push(cleaned);
          seenUids.add(collection.uid);
        }
      });
      
      const success = await batchUpdateCollections(cleanedCollections);
      if (success) {
        console.log('EMERGENCY CLEANUP: Fixed', cleanedCollections.length, 'collections using new storage');
      } else {
        throw new Error('Batch update failed');
      }
    } catch (error) {
      console.log('EMERGENCY CLEANUP: Falling back to legacy cleanup');
      // Fallback to legacy cleanup
      const { tabsArray } = await browser.storage.local.get('tabsArray');
      if (tabsArray && tabsArray.length > 0) {
        const cleanedCollections = [];
        const seenUids = new Set();
        
        tabsArray.forEach((collection) => {
          if (collection.uid && !seenUids.has(collection.uid) && collection.type !== 'folder') {
            const cleaned = { ...collection };
            delete cleaned.parentFolderId;
            cleaned.type = 'collection';
            cleanedCollections.push(cleaned);
            seenUids.add(collection.uid);
          }
        });
        
        await browser.storage.local.set({ tabsArray: cleanedCollections });
        console.log('EMERGENCY CLEANUP: Fixed', cleanedCollections.length, 'collections using legacy storage');
      }
    }
    
    // Reload data
    await loadCollectionsFromStorage();
    console.log('EMERGENCY CLEANUP: Complete!');
  };
  
  // Emergency storage cleanup - updated to work with new system
  const emergencyStorageCleanup = async () => {
    try {
      console.log('🚨 EMERGENCY STORAGE CLEANUP: Starting...');
      
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
      
      console.log(`🧹 Removing ${keysToRemove.length} keys:`, keysToRemove);
      
      if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
      }
      
      console.log('✅ Emergency storage cleanup complete!');
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
    console.log('🚨 EMERGENCY RECOVERY: Attempting to restore from latest backup...');
    
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
        console.log('✅ EMERGENCY RECOVERY: Successfully restored data!');
        openSuccessSnackbar('Emergency recovery completed - data restored from backup');
      } else {
        console.log('❌ EMERGENCY RECOVERY: No valid backups found');
        openErrorSnackbar('Emergency recovery failed - no valid backups available');
      }
    } catch (error) {
      console.error('💥 EMERGENCY RECOVERY: Failed:', error);
      openErrorSnackbar('Emergency recovery failed - migration system not available');
    }
  };

  // Make emergency functions available in console
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.emergencyCleanup = emergencyCleanup;
      window.emergencyRecovery = emergencyRecovery;
      window.emergencyStorageCleanup = emergencyStorageCleanup;
      
      // Enhanced storage stats with new system
      window.getStorageStats = async () => {
        const stats = await getNewStorageStats();
        if (stats) {
          console.log('📊 New Storage System Stats:');
          console.log(`Collections: ${stats.collections}`);
          console.log(`Total Tabs: ${stats.totalTabs}`);
          console.log(`Storage Size: ${(stats.totalSize / 1024).toFixed(1)}KB`);
          console.log(`Has Legacy Data: ${stats.hasLegacyData}`);
          if (stats.hasLegacyData) {
            console.log(`Legacy Size: ${(stats.legacySize / 1024).toFixed(1)}KB`);
          }
          console.log(`Storage Version: ${stats.storageVersion}`);
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
          
          console.log('📊 Migration Status:', status);
          return status;
        } catch (error) {
          console.error('Error getting migration status:', error);
          return { error: error.message };
        }
      };
      
      // New function to test storage performance
      window.testStoragePerformance = async () => {
        console.log('🏃‍♂️ Testing storage performance...');
        
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
        
        console.log('🚀 Storage Performance Results:');
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
          
          console.log(`📊 Backup Storage Analysis:`);
          console.log(`  PreSync Backups: ${preSyncBackups.length} backups, ${(preSyncSize/1024).toFixed(1)}KB`);
          console.log(`  Auto Backups: ${autoBackups.length} backups, ${(autoBackupSize/1024).toFixed(1)}KB`);
          console.log(`  Total Backup Storage: ${(totalSize/1024).toFixed(1)}KB`);
          
          if (totalSize > 2 * 1024 * 1024) { // > 2MB
            console.log(`⚠️  Backup storage is large (${(totalSize/1024/1024).toFixed(1)}MB). Consider running window.cleanupBackups()`);
          } else {
            console.log(`✅ Backup storage is within optimal limits`);
          }
          
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
          console.log('🧹 Starting backup cleanup...');
          
          const result = await browser.runtime.sendMessage({ 
            type: 'cleanupBackups' 
          });
          
          if (result) {
            console.log('✅ Backup cleanup completed successfully');
            // Show updated sizes
            await window.checkBackupSizes();
          } else {
            console.log('❌ Backup cleanup failed');
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
          console.log('📦 PreSync Backup Contents:');
          preSyncBackups.forEach((backup, index) => {
            console.log(`  Backup ${index + 1}: ${backup.label} (${new Date(backup.timestamp).toLocaleString()})`);
            console.log(`    Collections: ${backup.collectionCount || backup.tabsArray?.length || 0}`);
            console.log(`    Size: ${(JSON.stringify(backup).length/1024).toFixed(1)}KB`);
          });
          return preSyncBackups;
        } catch (error) {
          console.error('Error showing backup contents:', error);
          return [];
        }
      };
      
      console.log('🚨 Emergency functions available:');
      console.log('  - window.emergencyCleanup() - Fix collections and remove folders');
      console.log('  - window.emergencyStorageCleanup() - Remove large backup data');
      console.log('  - window.emergencyRecovery() - Full data recovery');
      console.log('  - window.getStorageStats() - Show storage breakdown');
      console.log('  - window.getMigrationStatus() - Check migration completion status');
      console.log('  - window.testStoragePerformance() - Test new storage performance');
      console.log('  - window.checkBackupSizes() - Analyze backup storage usage');
      console.log('  - window.cleanupBackups() - Clean up large backup files');
      console.log('  - window.showBackupContents() - Show backup metadata');
    }
  }, []);

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
    const initializeApp = async () => {
      // Initialize TimeAgo locale once for the entire app
      TimeAgo.addDefaultLocale(en);
      
      // Critical path: Load data first for faster perceived performance
      await Promise.all([
        applyTheme(),
        getSelectedSort(),
        getSelectedViewMode(),
        loadCollectionsFromStorage() // Start loading immediately
      ]);
      
      // Defer non-critical operations until after initial render
      setTimeout(async () => {
        await removeInactiveWindowsFromAutoUpdate();
        await checkSyncStatus();
      }, 100);
    };
    
    initializeApp();
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
        updateFolders={updateFolders}
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
