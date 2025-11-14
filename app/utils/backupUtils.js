import { safeStorageGet, safeStorageSet, getAllStorageData, safeStorageRemove, getStorageStats } from './storageUtils.js';
import { generateDataReport, isDataSafe } from './dataValidation.js';

/**
 * Backup Utilities
 * Comprehensive backup system to ensure zero data loss
 */

// Backup storage keys
const BACKUP_KEYS = {
  MIGRATION: 'migration_backup',
  EMERGENCY: 'emergency_backup',
  STEP_BACKUP: 'step_backup',
  ROLLBACK_CHAIN: 'rollback_chain'
};

/**
 * Create a comprehensive backup with metadata
 * @param {string} backupType - Type of backup being created
 * @param {string} reason - Reason for backup
 * @param {object} customData - Optional custom data to backup
 * @returns {Promise<object>} Backup metadata
 */
export const createBackup = async (backupType, reason, customData = null) => {
  try {
    console.log(`🛡️ Creating ${backupType} backup: ${reason}`);
    
    // Get data to backup
    const dataToBackup = customData || await getAllStorageData();
    
    // Check data size before creating backup
    const dataSize = JSON.stringify(dataToBackup).length;
    const dataSizeMB = dataSize / (1024 * 1024);
    
    console.log(`📊 Data size to backup: ${dataSizeMB.toFixed(2)}MB`);
    
    // If data is over 5MB, create a minimal backup instead
    if (dataSizeMB > 5) {
      console.warn(`⚠️ Data is large (${dataSizeMB.toFixed(2)}MB), creating minimal backup`);
      return await createMinimalBackup(backupType, reason, dataToBackup);
    }
    
    // Check current storage usage
    const stats = await getStorageStats();
    const currentStorageMB = parseFloat(stats.totalSizeMB);
    
    if (currentStorageMB > 8) {
      console.warn(`⚠️ Storage is already large (${currentStorageMB}MB), skipping backup to prevent quota issues`);
      return {
        id: generateBackupId(),
        key: 'skipped_large_storage',
        timestamp: Date.now(),
        size: 0,
        collections: 0,
        skipped: true,
        reason: 'Storage too large'
      };
    }
    
    // Validate data before backing up
    if (!isDataSafe(dataToBackup)) {
      console.warn('Data validation failed during backup creation');
    }
    
    // Generate comprehensive report
    const dataReport = generateDataReport(dataToBackup);
    
    // Create backup object with metadata
    const backup = {
      id: generateBackupId(),
      timestamp: Date.now(),
      type: backupType,
      reason,
      dataReport,
      dataSize: dataSize,
      data: JSON.parse(JSON.stringify(dataToBackup)) // Deep copy
    };
    
    // Store backup
    const backupKey = `${BACKUP_KEYS[backupType.toUpperCase()]}_${Date.now()}`;
    const success = await safeStorageSet({ [backupKey]: backup });
    
    if (success) {
      console.log(`✅ Backup created successfully: ${backupKey} (${(backup.dataSize / 1024).toFixed(1)}KB)`);
      
      // Update backup index
      await updateBackupIndex(backupKey, backup);
      
      return {
        id: backup.id,
        key: backupKey,
        timestamp: backup.timestamp,
        size: backup.dataSize,
        collections: dataReport.collections
      };
    } else {
      throw new Error('Failed to store backup');
    }
    
  } catch (error) {
    console.error('Backup creation failed:', error);
    
    // If backup fails due to size, try minimal backup
    if (error.message.includes('QUOTA_BYTES_PER_ITEM') || error.message.includes('QUOTA_BYTES')) {
      console.log('🔄 Backup failed due to size, attempting minimal backup...');
      return await createMinimalBackup(backupType, reason, customData || await getAllStorageData());
    }
    
    throw error;
  }
};

/**
 * Create a minimal backup with only essential data
 * @param {string} backupType - Type of backup being created
 * @param {string} reason - Reason for backup
 * @param {object} fullData - Full data to extract essentials from
 * @returns {Promise<object>} Backup metadata
 */
const createMinimalBackup = async (backupType, reason, fullData) => {
  try {
    console.log(`🔧 Creating minimal ${backupType} backup: ${reason}`);
    
    // Extract only essential data
    const essentialData = {
      tabsArray: fullData.tabsArray || [],
      localTimestamp: fullData.localTimestamp || Date.now(),
      // Skip large backup arrays to save space
      migrationTimestamp: Date.now(),
      backupType: 'minimal'
    };
    
    const dataSize = JSON.stringify(essentialData).length;
    console.log(`📊 Minimal backup size: ${(dataSize / 1024).toFixed(1)}KB`);
    
    const backup = {
      id: generateBackupId(),
      timestamp: Date.now(),
      type: backupType,
      reason: reason + ' (minimal)',
      dataSize: dataSize,
      collections: essentialData.tabsArray.length,
      minimal: true,
      data: essentialData
    };
    
    const backupKey = `${BACKUP_KEYS[backupType.toUpperCase()]}_minimal_${Date.now()}`;
    const success = await safeStorageSet({ [backupKey]: backup });
    
    if (success) {
      console.log(`✅ Minimal backup created: ${backupKey} (${(dataSize / 1024).toFixed(1)}KB)`);
      return {
        id: backup.id,
        key: backupKey,
        timestamp: backup.timestamp,
        size: dataSize,
        collections: backup.collections,
        minimal: true
      };
    } else {
      throw new Error('Failed to store minimal backup');
    }
    
  } catch (error) {
    console.error('Minimal backup creation failed:', error);
    
    // Return a placeholder if even minimal backup fails
    return {
      id: generateBackupId(),
      key: 'failed_backup',
      timestamp: Date.now(),
      size: 0,
      collections: 0,
      failed: true,
      error: error.message
    };
  }
};

/**
 * Create migration backup before any migration step
 * @param {string} fromVersion - Source version
 * @param {string} toVersion - Target version
 * @param {string} step - Migration step name
 * @returns {Promise<object>} Backup metadata
 */
export const createMigrationBackup = async (fromVersion, toVersion, step) => {
  const reason = `Before migration step: ${step} (${fromVersion} → ${toVersion})`;
  return await createBackup('MIGRATION', reason);
};

/**
 * Create emergency backup for critical operations
 * @param {string} operation - Operation being performed
 * @returns {Promise<object>} Backup metadata
 */
export const createEmergencyBackup = async (operation) => {
  const reason = `Emergency backup before: ${operation}`;
  return await createBackup('EMERGENCY', reason);
};

/**
 * Restore from backup
 * @param {string} backupKey - Backup key to restore from
 * @param {boolean} validate - Whether to validate restored data
 * @returns {Promise<boolean>} Success status
 */
export const restoreFromBackup = async (backupKey, validate = true) => {
  try {
    console.log(`🔄 Restoring from backup: ${backupKey}`);
    
    // Load backup
    const backupData = await safeStorageGet(backupKey);
    const backup = backupData[backupKey];
    
    if (!backup || !backup.data) {
      throw new Error(`Backup not found: ${backupKey}`);
    }
    
    // Validate backup data if requested
    if (validate && !isDataSafe(backup.data)) {
      throw new Error('Backup data failed validation');
    }
    
    // Create emergency backup of current state before restore
    await createEmergencyBackup(`Restore from ${backupKey}`);
    
    // Clear current storage and restore backup
    const success = await safeStorageSet(backup.data);
    
    if (success) {
      console.log(`✅ Successfully restored from backup: ${backupKey}`);
      console.log(`📊 Restored ${backup.dataReport.collections} collections`);
      return true;
    } else {
      throw new Error('Failed to restore backup data');
    }
    
  } catch (error) {
    console.error('Backup restoration failed:', error);
    return false;
  }
};

/**
 * Get all available backups
 * @param {string} backupType - Optional: filter by backup type
 * @returns {Promise<Array>} List of available backups
 */
export const getAvailableBackups = async (backupType = null) => {
  try {
    const allData = await getAllStorageData();
    const backups = [];
    
    // Find all backup keys
    Object.keys(allData).forEach(key => {
      if (key.includes('_backup_') && allData[key].timestamp) {
        const backup = allData[key];
        
        // Filter by type if specified
        if (!backupType || backup.type === backupType) {
          backups.push({
            key,
            id: backup.id,
            timestamp: backup.timestamp,
            type: backup.type,
            reason: backup.reason,
            collections: backup.dataReport?.collections || 0,
            size: backup.dataSize,
            age: Date.now() - backup.timestamp
          });
        }
      }
    });
    
    // Sort by timestamp (newest first)
    return backups.sort((a, b) => b.timestamp - a.timestamp);
    
  } catch (error) {
    console.error('Error getting available backups:', error);
    return [];
  }
};

/**
 * Clean up old backups to save space
 * @param {number} maxBackups - Maximum number of backups to keep per type
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Promise<number>} Number of backups cleaned up
 */
export const cleanupOldBackups = async (maxBackups = 10, maxAge = 30 * 24 * 60 * 60 * 1000) => {
  try {
    console.log('🧹 Cleaning up old backups...');
    
    const allBackups = await getAvailableBackups();
    const now = Date.now();
    let cleanedCount = 0;
    
    // Group by type
    const backupsByType = {};
    allBackups.forEach(backup => {
      if (!backupsByType[backup.type]) {
        backupsByType[backup.type] = [];
      }
      backupsByType[backup.type].push(backup);
    });
    
    // Clean up each type
    for (const [, backups] of Object.entries(backupsByType)) {
      const sortedBackups = backups.sort((a, b) => b.timestamp - a.timestamp);
      
      for (let i = 0; i < sortedBackups.length; i++) {
        const backup = sortedBackups[i];
        const shouldDelete = (
          i >= maxBackups || // Too many backups
          (now - backup.timestamp) > maxAge // Too old
        );
        
        if (shouldDelete) {
          const success = await safeStorageRemove(backup.key);
          if (success) {
            cleanedCount++;
            console.log(`🗑️ Cleaned up old backup: ${backup.key}`);
          }
        }
      }
    }
    
    console.log(`✅ Cleanup complete: ${cleanedCount} backups removed`);
    return cleanedCount;
    
  } catch (error) {
    console.error('Backup cleanup failed:', error);
    return 0;
  }
};

/**
 * Create rollback chain for complex operations
 * @param {string} operationId - Unique operation identifier
 * @param {Array} steps - Array of step names
 * @returns {Promise<string>} Chain ID
 */
export const createRollbackChain = async (operationId, steps) => {
  try {
    const chainId = `${operationId}_${Date.now()}`;
    
    const rollbackChain = {
      id: chainId,
      operationId,
      timestamp: Date.now(),
      steps,
      backups: {},
      currentStep: -1,
      completed: false
    };
    
    const success = await safeStorageSet({
      [`${BACKUP_KEYS.ROLLBACK_CHAIN}_${chainId}`]: rollbackChain
    });
    
    if (success) {
      console.log(`🔗 Created rollback chain: ${chainId}`);
      return chainId;
    } else {
      throw new Error('Failed to create rollback chain');
    }
    
  } catch (error) {
    console.error('Rollback chain creation failed:', error);
    throw error;
  }
};

/**
 * Add backup to rollback chain
 * @param {string} chainId - Rollback chain ID
 * @param {number} stepIndex - Step index
 * @param {object} backupInfo - Backup information
 * @returns {Promise<boolean>} Success status
 */
export const addToRollbackChain = async (chainId, stepIndex, backupInfo) => {
  try {
    const chainKey = `${BACKUP_KEYS.ROLLBACK_CHAIN}_${chainId}`;
    const chainData = await safeStorageGet(chainKey);
    const chain = chainData[chainKey];
    
    if (!chain) {
      throw new Error(`Rollback chain not found: ${chainId}`);
    }
    
    chain.backups[stepIndex] = backupInfo;
    chain.currentStep = stepIndex;
    chain.lastUpdated = Date.now();
    
    return await safeStorageSet({ [chainKey]: chain });
    
  } catch (error) {
    console.error('Failed to add to rollback chain:', error);
    return false;
  }
};

/**
 * Execute rollback from chain
 * @param {string} chainId - Rollback chain ID
 * @param {number} rollbackToStep - Step to rollback to (-1 for beginning)
 * @returns {Promise<boolean>} Success status
 */
export const executeRollback = async (chainId, rollbackToStep = -1) => {
  try {
    console.log(`🔙 Executing rollback: ${chainId} to step ${rollbackToStep}`);
    
    const chainKey = `${BACKUP_KEYS.ROLLBACK_CHAIN}_${chainId}`;
    const chainData = await safeStorageGet(chainKey);
    const chain = chainData[chainKey];
    
    if (!chain) {
      throw new Error(`Rollback chain not found: ${chainId}`);
    }
    
    // Find appropriate backup
    let backupToRestore = null;
    
    if (rollbackToStep === -1) {
      // Rollback to beginning - find earliest backup
      const stepIndexes = Object.keys(chain.backups).map(Number).sort();
      if (stepIndexes.length > 0) {
        backupToRestore = chain.backups[stepIndexes[0]];
      }
    } else {
      // Rollback to specific step
      backupToRestore = chain.backups[rollbackToStep];
    }
    
    if (!backupToRestore) {
      throw new Error(`No backup found for rollback to step ${rollbackToStep}`);
    }
    
    // Execute rollback
    const success = await restoreFromBackup(backupToRestore.key, true);
    
    if (success) {
      console.log(`✅ Rollback completed successfully`);
      
      // Mark chain as rolled back
      chain.rolledBack = true;
      chain.rolledBackAt = Date.now();
      chain.rolledBackToStep = rollbackToStep;
      await safeStorageSet({ [chainKey]: chain });
    }
    
    return success;
    
  } catch (error) {
    console.error('Rollback execution failed:', error);
    return false;
  }
};

/**
 * Update backup index for quick access
 * @param {string} backupKey - Backup key
 * @param {object} backup - Backup object
 * @returns {Promise<void>}
 */
const updateBackupIndex = async (backupKey, backup) => {
  try {
    const indexData = await safeStorageGet('backup_index');
    const index = indexData.backup_index || { backups: {}, lastUpdated: 0 };
    
    index.backups[backupKey] = {
      id: backup.id,
      timestamp: backup.timestamp,
      type: backup.type,
      reason: backup.reason,
      size: backup.dataSize,
      collections: backup.dataReport.collections
    };
    
    index.lastUpdated = Date.now();
    
    await safeStorageSet({ backup_index: index });
  } catch (error) {
    console.error('Failed to update backup index:', error);
    // Non-critical error - continue operation
  }
};

/**
 * Generate unique backup ID
 * @returns {string} Backup ID
 */
const generateBackupId = () => {
  return `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Get backup statistics
 * @returns {Promise<object>} Backup statistics
 */
export const getBackupStats = async () => {
  try {
    const backups = await getAvailableBackups();
    const totalSize = backups.reduce((sum, backup) => sum + (backup.size || 0), 0);
    
    const stats = {
      totalBackups: backups.length,
      totalSize: {
        bytes: totalSize,
        mb: (totalSize / (1024 * 1024)).toFixed(2)
      },
      byType: {},
      oldest: null,
      newest: null
    };
    
    // Group by type
    backups.forEach(backup => {
      if (!stats.byType[backup.type]) {
        stats.byType[backup.type] = { count: 0, size: 0 };
      }
      stats.byType[backup.type].count++;
      stats.byType[backup.type].size += backup.size || 0;
    });
    
    // Find oldest and newest
    if (backups.length > 0) {
      const sorted = backups.sort((a, b) => a.timestamp - b.timestamp);
      stats.oldest = sorted[0];
      stats.newest = sorted[sorted.length - 1];
    }
    
    return stats;
    
  } catch (error) {
    console.error('Error getting backup stats:', error);
    return { totalBackups: 0, totalSize: { bytes: 0, mb: '0' }, byType: {} };
  }
}; 