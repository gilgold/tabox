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
import { 
  createMigrationBackup, 
  createRollbackChain, 
  addToRollbackChain, 
  executeRollback,
  cleanupOldBackups 
} from './backupUtils.js';
import { COLOR_PALETTE } from './colorMigration.js';

/**
 * Migration configuration
 */
const MIGRATION_CONFIG = {
  SCHEMA_VERSION_KEY: 'tabox_schema_version',
  CURRENT_VERSION: '4.0', // Current production version (with folder support)
  TARGET_VERSION: '4.0',  // Current target version
  
  // Version definitions
  SUPPORTED_VERSIONS: {
    '3.0': {
      description: 'Enhanced format with UIDs',
      hasBackups: false,
      migrationComplexity: 'medium'
    },
    '3.5': {
      description: 'Index-based storage with backup systems',
      hasBackups: true,
      migrationComplexity: 'low'
    },
    '4.0': {
      description: 'Folder support with enhanced storage',
      hasBackups: true,
      migrationComplexity: 'low'
    }
  },
  
  // Migration paths
  MIGRATION_PATHS: {
    '3.0': ['enhanced_to_current'],
    '3.5': ['folders_initialization', 'timestamp_migration'], // Add folder system support + timestamp migration
    '3.5-color-migration-needed': ['color_migration', 'folders_initialization', 'timestamp_migration'], // Color migration + folder support + timestamps
    '4.0': ['timestamp_migration'], // Add timestamp migration for v4.0 → v4.0.1
    'unknown': ['enhanced_to_current'] // Safe fallback
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
      const currentVersion = await this.detectCurrentVersionFromData(currentData);
      
      // Check if migration has already been completed for this version
      const migrationHistory = await this.getMigrationHistory();
      const currentAppVersion = this.getCurrentAppVersion();
      
      // Always check for color migration needs, regardless of version history
      const needsColorMigration = this.needsColorMigration(currentData);
      
      if (migrationHistory.completedVersions && migrationHistory.completedVersions.includes(currentAppVersion)) {
        
        // Even if version migration is complete, check if color migration is needed
        if (needsColorMigration) {
          return {
            currentVersion,
            detectedFormat: detection.format,
            isDataValid: detection.isValid,
            dataErrors: detection.errors,
            collections: detection.info.collectionCount || 0,
            migrationNeeded: true,
            migrationPath: ['color_migration'],
            recommendations: ['Color system migration needed for old hex colors'],
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
      
      // Determine if migration is needed
      if (currentVersion !== MIGRATION_CONFIG.CURRENT_VERSION) {
        assessment.migrationNeeded = true;
        assessment.migrationPath = this.calculateMigrationPath(currentVersion);
        
        // Add recommendations based on current state
        if (assessment.collections === 0) {
          assessment.recommendations.push('No collections found - migration will be quick');
        } else if (assessment.collections > 50) {
          assessment.recommendations.push('Large collection count - migration may take longer');
        }
        
        if (!detection.isValid) {
          assessment.risks.push('Data validation errors detected - backup will be created');
        }
        
        if (detection.format === 'unknown') {
          assessment.risks.push('Unknown data format - using safe fallback migration');
        }
      } else {
        // Even if at current version, check if color migration is specifically needed
        // (needsColorMigration was already checked above)
        if (needsColorMigration) {
          assessment.migrationNeeded = true;
          assessment.migrationPath = ['color_migration'];
          assessment.recommendations.push('Color system migration needed for better compatibility');
        } else {
          assessment.recommendations.push('Already at current version - no migration needed');
        }
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

      // Execute migration steps
      const migrationResult = await this.executeMigrationSteps(
        assessment.currentVersion,
        assessment.migrationPath
      );

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
        
        const rollbackSuccess = await executeRollback(this.rollbackChainId);
        
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
        if (step === 'color_migration' || step === 'folders_initialization' || step === 'timestamp_migration') {
          const skipReason = step === 'color_migration' ? 
            'Color migration is safe operation' : 
            step === 'folders_initialization' ? 
            'Folder initialization is safe operation (no data changes)' :
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
        case 'enhanced_to_current':
          return await this.migrateEnhancedToCurrent(data);
          
        case 'color_migration':
          return await this.migrateColorsOnly(data);
          
        case 'current_to_document':
          return await this.migrateCurrentToDocument(data);
          
        case 'folders_initialization':
          return await this.migrateFoldersInitialization(data);
          
        case 'timestamp_migration':
          return await this.migrateTimestamps(data);
          
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
   * Migrate from enhanced format (3.0-3.4) to current format (3.5)
   * @param {object} data - Enhanced format data
   * @returns {Promise<object>} Current format data
   */
  async migrateEnhancedToCurrent(data) {
    
    // Import color migration utilities
    const { migrateAllCollectionColors } = await import('./colorMigration.js');
    
    // Ensure all collections have required fields
    const enhancedCollections = data.tabsArray.map((collection, index) => {
      // Safety check: ensure UID exists
      if (!collection.uid) {
        const seed = collection.name || index.toString();
        collection.uid = `enhanced_${btoa(seed).slice(0, 8)}_${Date.now().toString(36)}`;
        console.warn('Generated UID for collection during migration:', collection.name);
      }
      
      // Clean up any folder artifacts (safety measure)
      const cleanedCollection = { ...collection };
      delete cleanedCollection.parentId;
      if (cleanedCollection.type === 'folder') {
        return null; // Skip folder items
      }
      
      // Ensure all required fields
      return {
        ...cleanedCollection,
        type: 'collection',
        createdOn: cleanedCollection.createdOn || Date.now(),
        lastUpdated: cleanedCollection.lastUpdated !== null && cleanedCollection.lastUpdated !== undefined ? cleanedCollection.lastUpdated : Date.now(),
        lastOpened: cleanedCollection.lastOpened || null // Default to null for migrated collections
      };
    }).filter(Boolean); // Remove null entries (folders)
    
    // Migrate colors from old hex codes to new color names
    const colorMigratedCollections = migrateAllCollectionColors(enhancedCollections);
    
    // Add backup systems and enhanced metadata
    return {
      ...data,
      tabsArray: colorMigratedCollections,
      autoBackups: data.autoBackups || [],
      preSyncBackups: data.preSyncBackups || [],
      migrationSource: 'enhanced',
      migrationTimestamp: Date.now(),
      lastUpdated: Date.now(),
      colorSystemVersion: '2.0' // Mark as migrated to new color system
    };
  }

  /**
   * Migrate colors only for existing 3.5 users
   * @param {object} data - Current format data with old colors
   * @returns {Promise<object>} Data with migrated colors
   */
  async migrateColorsOnly(data) {
    try {
      
      if (!data.tabsArray || !Array.isArray(data.tabsArray)) {
        console.warn('⚠️ No tabsArray found in data - returning data unchanged');
        return {
          ...data,
          colorSystemVersion: '2.0',
          lastUpdated: Date.now(),
          colorMigrationTimestamp: Date.now()
        };
      }
      
      // Import color migration utilities
      const { migrateAllCollectionColors } = await import('./colorMigration.js');
      
      // Migrate colors in all collections
      const colorMigratedCollections = migrateAllCollectionColors(data.tabsArray);
      
      const result = {
        ...data,
        tabsArray: colorMigratedCollections,
        colorSystemVersion: '2.0', // Mark as migrated to new color system
        lastUpdated: Date.now(),
        colorMigrationTimestamp: Date.now()
      };
      
      
      return result;
      
    } catch (error) {
      console.error('❌ Color migration failed:', error);
      console.error('Error details:', error.stack);
      throw new Error(`Color migration failed: ${error.message}`);
    }
  }

  /**
   * Migrate from current format (3.5) to document format (4.0)
   * @param {object} data - Current format data
   * @returns {Promise<object>} Document format data
   */
  async migrateCurrentToDocument(data) {
    
    const collections = {};
    const collectionsIndex = [];
    
    // Transform array to document structure
    data.tabsArray.forEach(collection => {
      const collectionKey = `collection_${collection.uid}`;
      collections[collectionKey] = {
        ...collection,
        schemaVersion: '4.0',
        migratedFrom: '3.5',
        migrationTimestamp: Date.now()
      };
      collectionsIndex.push(collection.uid);
    });
    
    // Extract user settings from legacy data
    const userSettings = await this.extractUserSettings(data);
    
    return {
      // New document structure
      collections_index: collectionsIndex,
      app_metadata: {
        version: '4.0',
        lastUpdated: Date.now(),
        migrationSource: 'current',
        totalCollections: collectionsIndex.length,
        migrationTimestamp: Date.now()
      },
      user_settings: userSettings,
      
      // Store individual collections
      ...collections,
      
      // Keep legacy backup during transition
      _legacy_tabsArray: data.tabsArray,
      _legacy_backup: {
        timestamp: Date.now(),
        source: 'pre_4.0_migration',
        originalFormat: 'array',
        data: { ...data }
      }
    };
  }

  /**
   * Extract user settings from legacy data
   * @returns {Promise<object>} User settings object
   */
  async extractUserSettings() {
    // This would extract user preferences from the legacy storage
    // For now, return default settings
    return {
      theme: 'system',
      syncEnabled: true,
      autoBackup: true,
      maxBackups: 10,
      extractedFrom: 'legacy',
      extractionTimestamp: Date.now()
    };
  }

  /**
   * Initialize folder system for v4.0 (3.5 → 4.0 migration)
   * @param {object} data - v3.5 format data
   * @returns {Promise<object>} v4.0 format data with folder support
   */
  async migrateFoldersInitialization(data) {
    try {
      
      if (!data.tabsArray || !Array.isArray(data.tabsArray)) {
        console.warn('⚠️ No tabsArray found in data - returning data with folder system initialized');
        return {
          ...data,
          folderSystemVersion: '1.0',
          folders_index: {},
          lastUpdated: Date.now(),
          folderSystemInitTimestamp: Date.now()
        };
      }
      
      // Initialize empty folders index
      const foldersIndex = {};
      
      // Ensure all collections have parentId field (should be null initially)
      const updatedCollections = data.tabsArray.map(collection => ({
        ...collection,
        parentId: collection.parentId || null // Preserve existing parentId, default to null
      }));
      
      const result = {
        ...data,
        tabsArray: updatedCollections,
        folderSystemVersion: '1.0', // Mark as having folder system initialized
        folders_index: foldersIndex,
        lastUpdated: Date.now(),
        folderSystemInitTimestamp: Date.now()
      };
      
      
      return result;
      
    } catch (error) {
      console.error('❌ Folder system initialization failed:', error);
      console.error('Error details:', error.stack);
      throw new Error(`Folder system initialization failed: ${error.message}`);
    }
  }

  /**
   * Migrate v2 to v3: Populate lastUpdated timestamps for collections and folders
   * @param {object} data - v2 format data
   * @returns {Promise<object>} v3 format data with timestamps
   */
  async migrateTimestamps(data) {
    try {
      
      let migratedCollections = 0;
      let migratedFolders = 0;
      
      // Migrate collections
      if (data.tabsArray && Array.isArray(data.tabsArray)) {
        
        data.tabsArray = data.tabsArray.map(collection => {
          // Only add lastUpdated if it doesn't exist
          if (collection.lastUpdated === null || collection.lastUpdated === undefined) {
            // Use createdOn as fallback, or current time if that's missing too
            const fallbackTime = collection.createdOn || Date.now();
            migratedCollections++;
            
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
            migratedFolders++;
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
      // Check for explicit version first
      const explicitVersion = versionData[MIGRATION_CONFIG.SCHEMA_VERSION_KEY];
      
      if (explicitVersion && MIGRATION_CONFIG.SUPPORTED_VERSIONS[explicitVersion]) {
        return explicitVersion;
      }

      // Detect based on data structure
      const detection = detectAndValidateFormat(versionData);
      
      if (detection.format === 'document') {
        return '4.0';
      } else if (detection.format === 'array') {
        // Determine array sub-version
        if (versionData.autoBackups !== undefined || versionData.preSyncBackups !== undefined) {
          // Check if color migration is needed for 3.5 users
          if (!versionData.colorSystemVersion || versionData.colorSystemVersion < '2.0') {
            return '3.5-color-migration-needed';
          }
          return '3.5';
        } else {
          return '3.0';
        }
      } else if (detection.format === 'empty') {
        return MIGRATION_CONFIG.CURRENT_VERSION; // New installation
      } else {
        return 'unknown';
      }

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

    
    let foundOldColors = false;
    let checkedCollections = 0;
    let colorsFound = 0;
    
    // Check if any collection has old hex colors that need migration
    const needsMigration = data.tabsArray.some(collection => {
      checkedCollections++;
      
      // Check main collection color
      if (collection.color) {
        colorsFound++;
        
        if (collection.color.startsWith('#')) {
          // If it's a hex code that's not in our new palette values, it needs migration
          const isNewColor = Object.values(COLOR_PALETTE).includes(collection.color);
          if (!isNewColor) {
            foundOldColors = true;
            return true;
          } else {
          }
        } else {
          // Check if it's an unknown color name that's not in our palette
          if (!COLOR_PALETTE[collection.color] && !collection.color.startsWith('var(--')) {
            foundOldColors = true;
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
                foundOldColors = true;
                return true;
              }
            } else if (!COLOR_PALETTE[group.color] && !group.color.startsWith('var(--')) {
              foundOldColors = true;
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
           MIGRATION_CONFIG.MIGRATION_PATHS['unknown'];
  }

  /**
   * Get target version for a migration step
   * @param {string} step - Migration step
   * @returns {string} Target version
   */
  getTargetVersionForStep(step) {
    const stepVersionMap = {
      'enhanced_to_current': '3.5',
      'color_migration': '3.5',
      'current_to_document': '4.0',
      'folders_initialization': '4.0',
      'timestamp_migration': '4.0' // v3 storage version, still app version 4.0
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
      const finalStats = await getStorageStats();
      
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
   * @returns {Promise<void>}
   */
  async markMigrationCompleted() {
    try {
      const history = await this.getMigrationHistory();
      const currentAppVersion = this.getCurrentAppVersion();
      
      if (!history.completedVersions.includes(currentAppVersion)) {
        history.completedVersions.push(currentAppVersion);
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
        return '3.5.1';
      }
    } catch (error) {
      console.error('Error getting app version:', error);
      return '3.5.1';
    }
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