/**
 * Migration Coordinator
 * Single source of truth for all data migration operations
 * 
 * Note: This module requires browser extension context and cannot run in Service Workers
 */

// Compatibility check - ensure we're in the right context
if (typeof window === 'undefined' && typeof importScripts !== 'undefined') {
  throw new Error('Migration system cannot run in Service Worker context. Use from main app only.');
}

import { getAllStorageData, safeStorageSet, safeStorageGet, safeStorageRemove, atomicStorageTransaction, getStorageStats } from './storageUtils.js';
import { detectAndValidateFormat, isDataSafe } from './dataValidation.js';
import { assessMigrationSupport40 } from './migrationSupport40.js';
import { 
  createMigrationBackup, 
  createRollbackChain, 
  addToRollbackChain, 
  executeRollback,
  cleanupOldBackups 
} from './backupUtils.js';
import { COLOR_PALETTE } from './colorMigration.js';
import { unwrapDeferredUrl } from './urlUtils.js';
import { withDataSafetyGuard } from './migrationSafety';

/**
 * Migration configuration
 */
const MIGRATION_CONFIG = {
  SCHEMA_VERSION_KEY: 'tabox_schema_version',
  CURRENT_VERSION: '4.0', // Current production version (with folder support)
  TARGET_VERSION: '4.0',  // Current target version
  
  // Version definitions
  SUPPORTED_VERSIONS: {
    '4.0': {
      description: 'Folder support with enhanced storage',
      hasBackups: true,
      migrationComplexity: 'low'
    }
  },
  
  // Migration paths. The effective path is computed dynamically by
  // assessMigrationSupport40 based on the current data; this map is a documented default.
  MIGRATION_PATHS: {
    '4.0': ['timestamp_migration', 'repair_deferred_urls']
  }
};

/**
 * Main Migration Coordinator Class
 */
class MigrationCoordinator {
  constructor() {
    this.isRunning = false;
    this.currentOperation = null;
    this.rollbackChainId = null;
  }

  /**
   * Check if migration is needed and safe to run
   * @returns {Promise<object>} Migration status and recommendations
   */
  async assessMigrationNeeds() {
    try {
      
      const currentData = await getAllStorageData();
      const detection = detectAndValidateFormat(currentData);
      const supportAssessment = assessMigrationSupport40(currentData);
      const currentVersion = supportAssessment.currentVersion;

      if (!supportAssessment.supported) {
        return {
          currentVersion,
          detectedFormat: detection.format,
          isDataValid: detection.isValid,
          dataErrors: detection.errors,
          collections: detection.info.collectionCount || 0,
          migrationNeeded: false,
          migrationPath: [],
          recommendations: ['Automatic migration is only supported for 4.0+ local data'],
          risks: ['Unsupported pre-4.0 runtime data detected'],
          alreadyCompleted: false,
          unsupported: true,
          unsupportedReason: supportAssessment.unsupportedReason
        };
      }
      
      // Check if migration has already been completed for this version
      const migrationHistory = await this.getMigrationHistory();
      const currentAppVersion = this.getCurrentAppVersion();
      // Use major.minor for comparison - patch versions don't need new migrations
      const majorMinorVersion = this.getMajorMinorVersion(currentAppVersion);

      // Always check for color migration needs, regardless of version history
      const needsColorMigration = this.needsColorMigration(currentData);

      if (migrationHistory.completedVersions && migrationHistory.completedVersions.includes(majorMinorVersion)) {

        // Even after this major.minor is marked complete, re-run the idempotent,
        // detection-gated repairs when the current data still needs them. These steps
        // only act when their condition is present and become no-ops afterwards, so it
        // is safe to re-check them. This is what lets a patch update (e.g. 4.1 -> 4.1.1)
        // repair data written by an earlier build of the same major.minor.
        const supportPath = supportAssessment.migrationPath || [];
        const repairSteps = [];
        if (needsColorMigration || supportPath.includes('color_migration')) {
          repairSteps.push('color_migration');
        }
        if (supportPath.includes('repair_deferred_urls')) {
          repairSteps.push('repair_deferred_urls');
        }

        if (repairSteps.length > 0) {
          return {
            currentVersion,
            detectedFormat: detection.format,
            isDataValid: detection.isValid,
            dataErrors: detection.errors,
            collections: detection.info.collectionCount || 0,
            migrationNeeded: true,
            migrationPath: repairSteps,
            recommendations: ['Idempotent data repair needed (legacy colors and/or deferred-loading URLs)'],
            risks: [],
            alreadyCompleted: false
          };
        }

        return {
          currentVersion,
          detectedFormat: detection.format,
          isDataValid: detection.isValid,
          dataErrors: detection.errors,
          collections: detection.info.collectionCount || 0,
          migrationNeeded: false,
          migrationPath: [],
          recommendations: [`Migration already completed for version ${currentAppVersion}`],
          risks: [],
          alreadyCompleted: true
        };
      }
      
      const assessment = {
        currentVersion,
        detectedFormat: detection.format,
        isDataValid: detection.isValid,
        dataErrors: detection.errors,
        collections: detection.info.collectionCount || 0,
        migrationNeeded: false,
        migrationPath: [],
        recommendations: [],
        risks: [],
        alreadyCompleted: false
      };
      
      if (supportAssessment.migrationNeeded) {
        assessment.migrationNeeded = true;
        assessment.migrationPath = supportAssessment.migrationPath;
      } else {
        assessment.recommendations.push('Already at current version - no migration needed');
      }
      
      return assessment;
      
    } catch (error) {
      console.error('Migration assessment failed:', error);
      return {
        currentVersion: 'unknown',
        migrationNeeded: false,
        error: error.message,
        recommendations: ['Manual data inspection recommended']
      };
    }
  }

  /**
   * Execute migration with full safety measures
   * @param {boolean} force - Force migration even if not needed
   * @returns {Promise<object>} Migration result
   */
  async executeMigration(force = false) {
    // Check for existing migration lock
    const migrationLock = await this.checkMigrationLock();
    if (migrationLock && !force) {
      return {
        success: true,
        message: 'Migration skipped - already in progress or recently completed',
        skipped: true
      };
    }

    if (this.isRunning) {
      return {
        success: true,
        message: 'Migration already running in this instance',
        skipped: true
      };
    }

    try {
      this.isRunning = true;
      
      // Set migration lock
      await this.setMigrationLock();
      

      // Assess migration needs
      const assessment = await this.assessMigrationNeeds();
      
      if (!assessment.migrationNeeded && !force) {
        return {
          success: true,
          message: 'No migration required',
          assessment
        };
      }

      // Create rollback chain for the entire operation
      const operationId = `migration_${Date.now()}`;
      this.rollbackChainId = await createRollbackChain(operationId, assessment.migrationPath);

      // Second snapshot layered on top of the coordinator's own createRollbackChain
      // backup — kept deliberately as defense-in-depth so a failed migration can always
      // be unwound even when the rollback chain itself is incomplete.
      const guarded = await withDataSafetyGuard(`coordinator:${(assessment.migrationPath || []).join(',')}`, () =>
        this.executeMigrationSteps(assessment.currentVersion, assessment.migrationPath)
      );
      // If the guard restored due to an invariant violation, surface it as a failed step result.
      const migrationResult = guarded.restored
        ? { success: false, error: 'data-safety guard restored snapshot', restored: true }
        : guarded;

      if (migrationResult.success) {
        // Update schema version
        await this.updateSchemaVersion(MIGRATION_CONFIG.CURRENT_VERSION);
        
        // Mark migration as completed for this app version
        await this.markMigrationCompleted();
        
        // Clear migration lock after successful completion
        await this.clearMigrationLock();
        
        // Cleanup old backups (but be careful about size)
        await this.cleanupOldBackupsSafely();
        
        return {
          success: true,
          message: 'Migration completed successfully',
          fromVersion: assessment.currentVersion,
          toVersion: MIGRATION_CONFIG.CURRENT_VERSION,
          stepsExecuted: assessment.migrationPath.length,
          rollbackChainId: this.rollbackChainId
        };
      } else {
        // Migration failed - execute rollback
        console.error('❌ Migration failed, executing rollback...');
        
        // Clear migration lock on failure
        await this.clearMigrationLock();
        
        const rollbackSuccess = migrationResult.restored
          ? true // data-safety guard already restored the pre-migration snapshot
          : await executeRollback(this.rollbackChainId);

        return {
          success: false,
          message: 'Migration failed and was rolled back',
          error: migrationResult.error,
          rollbackSuccess
        };
      }

    } catch (error) {
      console.error('Migration execution failed:', error);
      
      // Clear migration lock on error
      await this.clearMigrationLock();
      
      // Attempt emergency rollback if we have a chain
      if (this.rollbackChainId) {
        await executeRollback(this.rollbackChainId);
      }
      
      return {
        success: false,
        message: 'Migration failed with error',
        error: error.message
      };
    } finally {
      this.isRunning = false;
      this.currentOperation = null;
      this.rollbackChainId = null;
    }
  }

  /**
   * Execute individual migration steps
   * @param {string} fromVersion - Starting version
   * @param {Array} migrationPath - Steps to execute
   * @returns {Promise<object>} Execution result
   */
  async executeMigrationSteps(fromVersion, migrationPath) {
    try {
      let currentData = await getAllStorageData();
      let currentVersion = fromVersion;

      for (let i = 0; i < migrationPath.length; i++) {
        const step = migrationPath[i];
        this.currentOperation = `Step ${i + 1}/${migrationPath.length}: ${step}`;
        
        
        // Create backup before this step (skip for safe migrations to save space)
        let backupInfo;
        if (step === 'color_migration' || step === 'timestamp_migration') {
          const skipReason = step === 'color_migration' ? 
            'Color migration is safe operation' : 
            'Timestamp migration is safe operation (only adds missing timestamps)';
          backupInfo = {
            id: `${step}_no_backup`,
            key: `${step}_no_backup`,
            timestamp: Date.now(),
            size: 0,
            collections: 0,
            skipped: true,
            reason: skipReason
          };
        } else {
          backupInfo = await createMigrationBackup(
            currentVersion,
            this.getTargetVersionForStep(step),
            step
          );
        }
        
        // Add to rollback chain
        await addToRollbackChain(this.rollbackChainId, i, backupInfo);
        
        // Execute the step within an atomic transaction
        
        const stepResult = await atomicStorageTransaction(async () => {
          
          try {
            const transformedData = await this.executeStep(step, currentData);
            
            // Validate transformed data
            if (!isDataSafe(transformedData)) {
              throw new Error(`Step ${step} produced invalid data`);
            }
            
            // Store transformed data (with size optimization)
            const transformedDataSize = JSON.stringify(transformedData).length / (1024 * 1024);
            if (transformedDataSize > 5) {
              console.warn(`⚠️ Large migration data (${transformedDataSize.toFixed(2)}MB) - storing with optimization`);
            }
            
            await safeStorageSet(transformedData);
            
            return transformedData;
            
          } catch (stepError) {
            console.error(`❌ Error in step ${step}:`, stepError);
            throw stepError;
          }
        });

        
        if (stepResult === false) {
          console.error(`❌ Migration step ${step} failed - atomic transaction returned false`);
          throw new Error(`Migration step ${step} failed`);
        }
        
        // Update current data and version for next step
        currentData = await getAllStorageData();
        currentVersion = this.getTargetVersionForStep(step);
        
      }

      return { success: true };

    } catch (error) {
      console.error('Migration step execution failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a specific migration step
   * @param {string} step - Step name
   * @param {object} data - Input data
   * @returns {Promise<object>} Transformed data
   */
  async executeStep(step, data) {
    
    try {
      switch (step) {
        case 'color_migration':
          return await this.migrateColorsOnly(data);
          
        case 'timestamp_migration':
          return await this.migrateTimestamps(data);

        case 'repair_deferred_urls':
          return await this.repairDeferredUrls(data);

        default:
          throw new Error(`Unknown migration step: ${step}`);
      }
    } catch (error) {
      console.error(`❌ Migration step ${step} failed:`, error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  /**
   * Repair old collection colors in 4.0-era local data.
   *
   * Migration is triggered by hex colors found in the indexed collection_<uid> /
   * folder_<uid> records (see migrationSupport40.hasLegacyColorValues), so this must
   * rewrite those records - not only the legacy tabsArray mirror. Otherwise the records
   * keep their hex colors, the step never actually fixes anything, and detection
   * re-triggers it on every launch.
   * @param {object} data - Current format data with old colors
   * @returns {Promise<object>} Data with migrated colors
   */
  async migrateColorsOnly(data) {
    try {
      const { migrateAllCollectionColors, migrateColor } = await import('./colorMigration.js');

      const result = { ...data };

      // 1) Legacy tabsArray mirror (backups/exports/sync stay consistent).
      if (Array.isArray(result.tabsArray)) {
        result.tabsArray = migrateAllCollectionColors(result.tabsArray);
      }

      // 2) Indexed records - the source of truth for display and the keys detection
      //    actually inspects. Collections migrate color + chromeGroups colors; folders
      //    migrate their single color value.
      Object.keys(result).forEach((key) => {
        const value = result[key];
        if (!value || typeof value !== 'object') {
          return;
        }

        if (key.startsWith('collection_')) {
          result[key] = migrateAllCollectionColors([value])[0];
        } else if (key.startsWith('folder_') && typeof value.color === 'string' && typeof migrateColor === 'function') {
          const migrated = migrateColor(value.color);
          if (migrated !== value.color) {
            result[key] = { ...value, color: migrated };
          }
        }
      });

      // 3) Keep collections_index color metadata in sync with the migrated records.
      const index = result.collections_index;
      if (index && typeof index === 'object' && !Array.isArray(index)) {
        const nextIndex = { ...index };
        Object.keys(nextIndex).forEach((uid) => {
          const record = result[`collection_${uid}`];
          if (record && typeof record.color === 'string' && nextIndex[uid]) {
            nextIndex[uid] = { ...nextIndex[uid], color: record.color };
          }
        });
        result.collections_index = nextIndex;
      }

      result.colorSystemVersion = '2.0'; // Mark as migrated to new color system
      result.lastUpdated = Date.now();
      result.colorMigrationTimestamp = Date.now();

      return result;

    } catch (error) {
      console.error('❌ Color migration failed:', error);
      console.error('Error details:', error.stack);
      throw new Error(`Color migration failed: ${error.message}`);
    }
  }

  /**
   * Migrate v2 to v3: Populate lastUpdated timestamps for collections and folders
   * @param {object} data - v2 format data
   * @returns {Promise<object>} v3 format data with timestamps
   */
  async migrateTimestamps(data) {
    try {
      
      // Migrate collections
      if (data.tabsArray && Array.isArray(data.tabsArray)) {
        
        data.tabsArray = data.tabsArray.map(collection => {
          // Only add lastUpdated if it doesn't exist
          if (collection.lastUpdated === null || collection.lastUpdated === undefined) {
            // Use createdOn as fallback, or current time if that's missing too
            const fallbackTime = collection.createdOn || Date.now();

            return {
              ...collection,
              lastUpdated: fallbackTime,
              // Ensure lastOpened exists (defaults to null)
              lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null
            };
          }
          
          // Just ensure lastOpened exists for collections that already have lastUpdated
          return {
            ...collection,
            lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null
          };
        });
      }
      
      // Migrate folders (from folders_index if it exists)
      if (data.folders_index && typeof data.folders_index === 'object') {
        
        // Update each folder in the index
        Object.keys(data.folders_index).forEach(folderUid => {
          const folder = data.folders_index[folderUid];
          if (folder && (folder.lastUpdated === null || folder.lastUpdated === undefined)) {
            const fallbackTime = folder.createdOn || Date.now();
            data.folders_index[folderUid] = {
              ...folder,
              lastUpdated: fallbackTime
            };
          }
        });
      }
      
      // Update storage version marker
      const result = {
        ...data,
        storageVersion: 3,
        timestampMigrationCompleted: true,
        timestampMigrationTimestamp: Date.now()
      };
      
      
      return result;
      
    } catch (error) {
      console.error('❌ Timestamp migration failed:', error);
      console.error('Error details:', error.stack);
      throw new Error(`Timestamp migration failed: ${error.message}`);
    }
  }

  /**
   * Repair collections whose tab URLs were persisted as the deferred-loading wrapper
   * (chrome-extension://.../deferedLoading.html?url=...). Rewrites them back to the real
   * destination across the indexed collection_<uid> records and the legacy tabsArray
   * mirror. Idempotent: tabs that are already real URLs are left untouched.
   * @param {object} data - Current storage data
   * @returns {Promise<object>} Data with deferred wrapper URLs unwrapped
   */
  async repairDeferredUrls(data) {
    try {
      const repairTabs = (tabs) => (
        Array.isArray(tabs)
          ? tabs.map((tab) => {
            if (!tab || typeof tab.url !== 'string') {
              return tab;
            }
            const unwrapped = unwrapDeferredUrl(tab.url);
            return unwrapped === tab.url ? tab : { ...tab, url: unwrapped };
          })
          : tabs
      );

      const result = { ...data };

      // Repair the indexed collection_<uid> records (the source of truth for display).
      Object.keys(result).forEach((key) => {
        if (key.startsWith('collection_') && result[key] && Array.isArray(result[key].tabs)) {
          result[key] = { ...result[key], tabs: repairTabs(result[key].tabs) };
        }
      });

      // Repair the legacy tabsArray mirror so backups/exports/sync stay consistent.
      if (Array.isArray(result.tabsArray)) {
        result.tabsArray = result.tabsArray.map((collection) => (
          collection && Array.isArray(collection.tabs)
            ? { ...collection, tabs: repairTabs(collection.tabs) }
            : collection
        ));
      }

      result.deferredUrlRepairTimestamp = Date.now();

      return result;

    } catch (error) {
      console.error('❌ Deferred URL repair failed:', error);
      console.error('Error details:', error.stack);
      throw new Error(`Deferred URL repair failed: ${error.message}`);
    }
  }

  /**
   * Detect current schema version
   * @returns {Promise<string>} Current version
   */
  async detectCurrentVersion() {
    try {
      const versionData = await getAllStorageData();
      return this.detectCurrentVersionFromData(versionData);
    } catch (error) {
      console.error('Version detection failed:', error);
      return 'unknown';
    }
  }

  /**
   * Detect current schema version from provided data
   * @param {object} versionData - Data to analyze
   * @returns {string} Current version
   */
  detectCurrentVersionFromData(versionData) {
    try {
      return assessMigrationSupport40(versionData).currentVersion;
    } catch (error) {
      console.error('Version detection from data failed:', error);
      return 'unknown';
    }
  }

  /**
   * Check if collections need color migration (have old hex codes)
   * @param {object} data - User data to check
   * @returns {boolean} True if color migration is needed
   */
  needsColorMigration(data) {
    
    if (!data.tabsArray || !Array.isArray(data.tabsArray)) {
      return false;
    }

    
    // Check if any collection has old hex colors that need migration
    const needsMigration = data.tabsArray.some(collection => {
      // Check main collection color
      if (collection.color) {
        if (collection.color.startsWith('#')) {
          // If it's a hex code that's not in our new palette values, it needs migration
          const isNewColor = Object.values(COLOR_PALETTE).includes(collection.color);
          if (!isNewColor) {
            return true;
          }
        } else {
          // Check if it's an unknown color name that's not in our palette
          if (!COLOR_PALETTE[collection.color] && !collection.color.startsWith('var(--')) {
            return true;
          }
        }
      }

      // Check chrome group colors
      if (collection.chromeGroups && Array.isArray(collection.chromeGroups)) {
        return collection.chromeGroups.some(group => {
          if (group.color) {
            
            if (group.color.startsWith('#')) {
              const isNewColor = Object.values(COLOR_PALETTE).includes(group.color);
              if (!isNewColor) {
                return true;
              }
            } else if (!COLOR_PALETTE[group.color] && !group.color.startsWith('var(--')) {
              return true;
            }
          }
          return false;
        });
      }

      return false;
    });

    
    return needsMigration;
  }

  /**
   * Calculate migration path for a given version
   * @param {string} fromVersion - Starting version
   * @returns {Array} Migration steps
   */
  calculateMigrationPath(fromVersion) {
    return MIGRATION_CONFIG.MIGRATION_PATHS[fromVersion] || 
           [];
  }

  /**
   * Get target version for a migration step
   * @param {string} step - Migration step
   * @returns {string} Target version
   */
  getTargetVersionForStep(step) {
    const stepVersionMap = {
      'color_migration': '4.0',
      'timestamp_migration': '4.0', // v3 storage version, still app version 4.0
      'repair_deferred_urls': '4.0' // idempotent data repair, no schema change
    };
    
    return stepVersionMap[step] || MIGRATION_CONFIG.CURRENT_VERSION;
  }

  /**
   * Update schema version in storage
   * @param {string} version - New version
   * @returns {Promise<boolean>} Success status
   */
  async updateSchemaVersion(version) {
    try {
      await safeStorageSet({
        [MIGRATION_CONFIG.SCHEMA_VERSION_KEY]: version,
        [`${MIGRATION_CONFIG.SCHEMA_VERSION_KEY}_updated`]: Date.now()
      });
      return true;
    } catch (error) {
      console.error('Failed to update schema version:', error);
      return false;
    }
  }

  /**
   * Get migration status
   * @returns {object} Current migration status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentOperation: this.currentOperation,
      rollbackChainId: this.rollbackChainId
    };
  }

  /**
   * Check if migration is already locked (in progress)
   * @returns {Promise<boolean>} True if migration is locked
   */
  async checkMigrationLock() {
    try {
      const lockData = await safeStorageGet('migration_lock');
      const lock = lockData.migration_lock;
      
      if (!lock) return false;
      
      // Check if lock is stale (older than 30 minutes)
      const lockAge = Date.now() - lock.timestamp;
      const isStale = lockAge > (30 * 60 * 1000); // 30 minutes
      
      if (isStale) {
        await this.clearMigrationLock();
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error checking migration lock:', error);
      return false;
    }
  }

  /**
   * Set migration lock
   * @returns {Promise<void>}
   */
  async setMigrationLock() {
    try {
      await safeStorageSet({
        migration_lock: {
          timestamp: Date.now(),
          processId: Math.random().toString(36)
        }
      });
    } catch (error) {
      console.error('Error setting migration lock:', error);
    }
  }

  /**
   * Clear migration lock
   * @returns {Promise<void>}
   */
  async clearMigrationLock() {
    try {
      await safeStorageRemove('migration_lock');
    } catch (error) {
      console.error('Error clearing migration lock:', error);
    }
  }

  /**
   * Safely cleanup old backups without creating huge storage operations
   * @returns {Promise<void>}
   */
  async cleanupOldBackupsSafely() {
    try {
      
      // Get current storage stats first
      const stats = await getStorageStats();
      const currentSizeMB = parseFloat(stats.totalSizeMB);
      
      
      // If storage is over 8MB, be more aggressive with cleanup
      const maxBackups = currentSizeMB > 8 ? 2 : 5;
      const maxAge = currentSizeMB > 8 ? (24 * 60 * 60 * 1000) : (7 * 24 * 60 * 60 * 1000); // 1 day vs 7 days
      
      await cleanupOldBackups(maxBackups, maxAge);
      
      // Check final size
      await getStorageStats();

    } catch (error) {
      console.error('Safe backup cleanup failed:', error);
    }
  }

  /**
   * Get migration history to track completed migrations
   * @returns {Promise<object>} Migration history
   */
  async getMigrationHistory() {
    try {
      const historyData = await safeStorageGet('migration_history');
      return historyData.migration_history || {
        completedVersions: [],
        lastMigrationTimestamp: 0,
        migrationAttempts: 0
      };
    } catch (error) {
      console.error('Error getting migration history:', error);
      return {
        completedVersions: [],
        lastMigrationTimestamp: 0,
        migrationAttempts: 0
      };
    }
  }

  /**
   * Mark migration as completed for current app version
   * Uses major.minor version so patch updates don't trigger unnecessary migrations
   * @returns {Promise<void>}
   */
  async markMigrationCompleted() {
    try {
      const history = await this.getMigrationHistory();
      const currentAppVersion = this.getCurrentAppVersion();
      // Save major.minor version - patch versions share migration state
      const majorMinorVersion = this.getMajorMinorVersion(currentAppVersion);

      if (!history.completedVersions.includes(majorMinorVersion)) {
        history.completedVersions.push(majorMinorVersion);
      }
      
      history.lastMigrationTimestamp = Date.now();
      history.migrationAttempts = (history.migrationAttempts || 0) + 1;
      
      // Keep only last 10 completed versions to save space
      if (history.completedVersions.length > 10) {
        history.completedVersions = history.completedVersions.slice(-10);
      }
      
      await safeStorageSet({ migration_history: history });
      
    } catch (error) {
      console.error('Error marking migration completed:', error);
    }
  }

  /**
   * Get current app version from manifest
   * @returns {string} Current app version
   */
  getCurrentAppVersion() {
    try {
      // In browser extension context, get version from manifest
      if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version;
      } else if (typeof window !== 'undefined' && typeof browser !== 'undefined' && browser.runtime && browser.runtime.getManifest) {
        return browser.runtime.getManifest().version;
      } else {
        // Fallback version for development/testing
        return MIGRATION_CONFIG.CURRENT_VERSION;
      }
    } catch (error) {
      console.error('Error getting app version:', error);
      return MIGRATION_CONFIG.CURRENT_VERSION;
    }
  }

  /**
   * Get major.minor version for migration tracking
   * Patch versions (x.y.Z) don't require new migrations
   * @param {string} version - Full version string (e.g., "4.0.1")
   * @returns {string} Major.minor version (e.g., "4.0")
   */
  getMajorMinorVersion(version) {
    const parts = version.split('.');
    return parts.slice(0, 2).join('.');
  }
}

// Export singleton instance
export const migrationCoordinator = new MigrationCoordinator();

// Export utility functions for direct use
export {
  MIGRATION_CONFIG
};

export const detectCurrentVersion = () => migrationCoordinator.detectCurrentVersion();
export const assessMigrationNeeds = () => migrationCoordinator.assessMigrationNeeds();
export const executeMigration = (force) => migrationCoordinator.executeMigration(force); 
