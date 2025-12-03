/**
 * Migration System Health Check
 * Verifies that all migration components are working correctly
 */

/**
 * Perform comprehensive health check of migration system
 * @returns {Promise<object>} Health check results
 */
export const performMigrationHealthCheck = async () => {
  const results = {
    timestamp: Date.now(),
    overall: 'unknown',
    components: {},
    errors: [],
    recommendations: []
  };

  try {
    // Test storage utilities
    results.components.storage = await testStorageUtils();
    
    // Test data validation
    results.components.validation = await testDataValidation();
    
    // Test backup system
    results.components.backup = await testBackupSystem();
    
    // Test migration coordinator
    results.components.coordinator = await testMigrationCoordinator();
    
    // Determine overall health
    const componentStatuses = Object.values(results.components);
    const allHealthyOrWarning = componentStatuses.every(status => status === 'healthy' || status === 'warning');
    const anyFailed = componentStatuses.some(status => status === 'failed');
    const allHealthy = componentStatuses.every(status => status === 'healthy');
    
    if (allHealthy) {
      results.overall = 'healthy';
    } else if (anyFailed) {
      results.overall = 'degraded';
      results.recommendations.push('Some migration components have issues - check console for details');
    } else if (allHealthyOrWarning) {
      results.overall = 'warning';
      results.recommendations.push('Migration system is functional but not all components are available in current context');
    } else {
      results.overall = 'warning';
      results.recommendations.push('Migration system has minor issues but should function');
    }
    
    return results;
    
  } catch (error) {
    results.overall = 'failed';
    results.errors.push(error.message);
    console.error('💥 Migration health check failed:', error);
    return results;
  }
};

/**
 * Test storage utilities
 * @returns {Promise<string>} Test status
 */
const testStorageUtils = async () => {
  try {
    // Check if we're in a browser extension context
    const hasBrowserAPI = (
      (typeof globalThis !== 'undefined' && globalThis.browser) ||
      (typeof window !== 'undefined' && window.browser) ||
      (typeof globalThis !== 'undefined' && globalThis.chrome)
    );
    
    if (!hasBrowserAPI) {
      return 'warning'; // Not failed, just not available
    }
    
    const { safeStorageGet, safeStorageSet, safeStorageRemove } = await import('./storageUtils.js');
    
    // Test basic storage operations
    const testKey = 'migration_health_test';
    const testData = { test: true, timestamp: Date.now() };
    
    const setResult = await safeStorageSet({ [testKey]: testData });
    if (!setResult) {
      throw new Error('Storage set operation failed');
    }
    
    const getData = await safeStorageGet(testKey);
    if (!getData[testKey] || getData[testKey].test !== true) {
      throw new Error('Storage get operation failed');
    }
    
    // Clean up test data
    await safeStorageRemove(testKey);
    
    return 'healthy';
  } catch (error) {
    console.error('Storage utils test failed:', error);
    return 'failed';
  }
};

/**
 * Test data validation
 * @returns {Promise<string>} Test status
 */
const testDataValidation = async () => {
  try {
    const { validateCollection, isDataSafe } = await import('./dataValidation.js');
    
    // Test with valid collection
    const validCollection = {
      uid: 'test_123',
      name: 'Test Collection',
      tabs: [{ uid: 'tab_123', url: 'https://example.com' }],
      type: 'collection'
    };
    
    const validation = validateCollection(validCollection);
    if (!validation.isValid) {
      throw new Error('Valid collection failed validation');
    }
    
    // Test data safety check
    const testData = { tabsArray: [validCollection] };
    if (!isDataSafe(testData)) {
      throw new Error('Safe data failed safety check');
    }
    
    return 'healthy';
  } catch (error) {
    console.error('Data validation test failed:', error);
    return 'failed';
  }
};

/**
 * Test backup system
 * @returns {Promise<string>} Test status
 */
const testBackupSystem = async () => {
  try {
    // Check if we're in a browser extension context
    const hasBrowserAPI = (
      (typeof globalThis !== 'undefined' && globalThis.browser) ||
      (typeof window !== 'undefined' && window.browser) ||
      (typeof globalThis !== 'undefined' && globalThis.chrome)
    );
    
    if (!hasBrowserAPI) {
      return 'warning'; // Not failed, just not available
    }
    
    const { createBackup, getAvailableBackups } = await import('./backupUtils.js');
    
    // Test backup creation (but don't actually create one for health check)
    // Just verify the functions are importable and callable
    if (typeof createBackup !== 'function') {
      throw new Error('createBackup is not a function');
    }
    
    if (typeof getAvailableBackups !== 'function') {
      throw new Error('getAvailableBackups is not a function');
    }
    
    return 'healthy';
  } catch (error) {
    console.error('Backup system test failed:', error);
    return 'failed';
  }
};

/**
 * Test migration coordinator
 * @returns {Promise<string>} Test status
 */
const testMigrationCoordinator = async () => {
  try {
    // Check if we're in a browser extension context
    const hasBrowserAPI = (
      (typeof globalThis !== 'undefined' && globalThis.browser) ||
      (typeof window !== 'undefined' && window.browser) ||
      (typeof globalThis !== 'undefined' && globalThis.chrome)
    );
    
    if (!hasBrowserAPI) {
      return 'warning'; // Not failed, just not available
    }
    
    const { assessMigrationNeeds, MIGRATION_CONFIG } = await import('./migrationCoordinator.js');
    
    // Test configuration exists
    if (!MIGRATION_CONFIG || !MIGRATION_CONFIG.CURRENT_VERSION) {
      throw new Error('Migration config is incomplete');
    }
    
    // Test assessment function exists
    if (typeof assessMigrationNeeds !== 'function') {
      throw new Error('assessMigrationNeeds is not a function');
    }
    
    return 'healthy';
  } catch (error) {
    console.error('Migration coordinator test failed:', error);
    return 'failed';
  }
};

/**
 * Quick migration system status check
 * @returns {Promise<boolean>} True if system is operational
 */
export const isMigrationSystemHealthy = async () => {
  try {
    const healthCheck = await performMigrationHealthCheck();
    return healthCheck.overall === 'healthy' || healthCheck.overall === 'warning';
  } catch (error) {
    console.error('Migration health status check failed:', error);
    return false;
  }
}; 