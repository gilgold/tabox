/**
 * Migration System - Central Export Index
 * Single point of import for all migration utilities
 */

// Core storage utilities
export {
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove,
  getAllStorageData,
  atomicStorageTransaction,
  getStorageStats,
  // New indexed storage system
  loadAllCollections,
  loadSingleCollection,
  saveSingleCollection,
  deleteSingleCollection,
  migrateLegacyStorage,
  getNewStorageStats,
  batchUpdateCollections,
  loadCollectionsIndex
} from './storageUtils.js';

// Data validation utilities
export {
  detectAndValidateFormat,
  isDataSafe
} from './dataValidation.js';

// Backup and recovery utilities
export {
  createBackup,
  createMigrationBackup,
  restoreFromBackup,
  getAvailableBackups,
  cleanupOldBackups,
  createRollbackChain,
  addToRollbackChain,
  executeRollback
} from './backupUtils.js';

// Migration coordination (main entry point)
export {
  migrationCoordinator,
  MIGRATION_CONFIG,
  detectCurrentVersion,
  assessMigrationNeeds,
  executeMigration
} from './migrationCoordinator.js';

// Color migration utilities
export {
  COLOR_PALETTE,
  migrateAllCollectionColors,
  getColorValue
} from './colorMigration.js';

/**
 * Emergency data recovery function
 * @returns {Promise<boolean>} Recovery success
 */
export const emergencyDataRecovery = async () => {
  try {
    
    // Get available backups
    const { getAvailableBackups, restoreFromBackup } = await import('./backupUtils.js');
    const backups = await getAvailableBackups();
    
    if (backups.length === 0) {
      return false;
    }
    
    // Find most recent valid backup
    const recentBackup = backups.find(backup => backup.collections > 0);
    
    if (!recentBackup) {
      return false;
    }
    
    const success = await restoreFromBackup(recentBackup.key);
    
    if (success) {
    } else {
    }
    
    return success;
    
  } catch (error) {
    console.error('💥 Emergency recovery failed:', error);
    return false;
  }
}; 