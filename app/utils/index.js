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
  validateCollection,
  validateArrayFormat,
  validateDocumentFormat,
  detectAndValidateFormat,
  generateDataReport,
  isDataSafe
} from './dataValidation.js';

// Backup and recovery utilities
export {
  createBackup,
  createMigrationBackup,
  createEmergencyBackup,
  restoreFromBackup,
  getAvailableBackups,
  cleanupOldBackups,
  createRollbackChain,
  addToRollbackChain,
  executeRollback,
  getBackupStats
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
  migrateColor,
  migrateCollectionColors,
  migrateAllCollectionColors,
  getColorValue,
  getColorNames,
  isValidColorName
} from './colorMigration.js';

/**
 * Quick migration status check
 * @returns {Promise<object>} Current migration status
 */
export const getMigrationStatus = async () => {
  try {
    // Import these here to avoid circular dependency issues
    const { assessMigrationNeeds, migrationCoordinator } = await import('./migrationCoordinator.js');
    
    const assessment = await assessMigrationNeeds();
    const coordinatorStatus = migrationCoordinator.getStatus();
    
    return {
      currentVersion: assessment.currentVersion,
      migrationNeeded: assessment.migrationNeeded,
      isRunning: coordinatorStatus.isRunning,
      currentOperation: coordinatorStatus.currentOperation,
      dataValid: assessment.isDataValid,
      collectionsCount: assessment.collections
    };
  } catch (error) {
    return {
      error: error.message,
      currentVersion: 'unknown',
      migrationNeeded: false,
      isRunning: false
    };
  }
};

/**
 * Emergency data recovery function
 * @returns {Promise<boolean>} Recovery success
 */
export const emergencyDataRecovery = async () => {
  try {
    console.log('🚨 Starting emergency data recovery...');
    
    // Get available backups
    const { getAvailableBackups, restoreFromBackup } = await import('./backupUtils.js');
    const backups = await getAvailableBackups();
    
    if (backups.length === 0) {
      console.log('❌ No backups available for recovery');
      return false;
    }
    
    // Find most recent valid backup
    const recentBackup = backups.find(backup => backup.collections > 0);
    
    if (!recentBackup) {
      console.log('❌ No valid backups found with collections');
      return false;
    }
    
    console.log(`🔄 Restoring from backup: ${recentBackup.key}`);
    const success = await restoreFromBackup(recentBackup.key);
    
    if (success) {
      console.log('✅ Emergency recovery completed successfully');
    } else {
      console.log('❌ Emergency recovery failed');
    }
    
    return success;
    
  } catch (error) {
    console.error('💥 Emergency recovery failed:', error);
    return false;
  }
}; 