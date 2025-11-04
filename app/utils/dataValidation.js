/**
 * Data Validation Utilities
 * Comprehensive validation functions for ensuring data integrity
 */

/**
 * Validate collection object structure
 * @param {object} collection - Collection to validate
 * @returns {object} { isValid: boolean, errors: string[] }
 */
export const validateCollection = (collection) => {
  const errors = [];
  
  if (!collection || typeof collection !== 'object') {
    return { isValid: false, errors: ['Collection must be an object'] };
  }
  
  // Required fields
  if (!collection.uid || typeof collection.uid !== 'string') {
    errors.push('Collection must have a valid UID');
  }
  
  if (!collection.name || typeof collection.name !== 'string') {
    errors.push('Collection must have a valid name');
  }
  
  if (!Array.isArray(collection.tabs)) {
    errors.push('Collection must have a tabs array');
  }
  
  // Optional but important fields
  if (collection.chromeGroups && !Array.isArray(collection.chromeGroups)) {
    errors.push('chromeGroups must be an array if present');
  }
  
  if (collection.type && collection.type !== 'collection') {
    errors.push('Collection type must be "collection"');
  }
  
  // Validate tabs
  if (collection.tabs) {
    collection.tabs.forEach((tab, index) => {
      if (!tab.uid) {
        errors.push(`Tab at index ${index} missing UID`);
      }
      if (!tab.url) {
        errors.push(`Tab at index ${index} missing URL`);
      }
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate array format data (3.0-3.5)
 * @param {object} data - Data object containing tabsArray
 * @returns {object} { isValid: boolean, errors: string[], collectionCount: number }
 */
export const validateArrayFormat = (data) => {
  const errors = [];
  let collectionCount = 0;
  
  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Data must be an object'], collectionCount: 0 };
  }
  
  if (!data.tabsArray) {
    errors.push('Missing tabsArray');
  } else if (!Array.isArray(data.tabsArray)) {
    errors.push('tabsArray must be an array');
  } else {
    collectionCount = data.tabsArray.length;
    
    // Validate each collection
    data.tabsArray.forEach((collection, index) => {
      const validation = validateCollection(collection);
      if (!validation.isValid) {
        errors.push(`Collection ${index}: ${validation.errors.join(', ')}`);
      }
    });
    
    // Check for duplicate UIDs
    const uids = data.tabsArray.map(c => c.uid).filter(Boolean);
    const uniqueUids = new Set(uids);
    if (uids.length !== uniqueUids.size) {
      errors.push('Duplicate collection UIDs found');
    }
  }
  
  // Validate timestamps
  if (data.localTimestamp && typeof data.localTimestamp !== 'number') {
    errors.push('localTimestamp must be a number');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    collectionCount
  };
};

/**
 * Validate document format data (4.0+)
 * @param {object} data - Data object containing document structure
 * @returns {object} { isValid: boolean, errors: string[], collectionCount: number }
 */
export const validateDocumentFormat = (data) => {
  const errors = [];
  let collectionCount = 0;
  
  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Data must be an object'], collectionCount: 0 };
  }
  
  // Validate collections index
  if (!data.collections_index) {
    errors.push('Missing collections_index');
  } else if (!Array.isArray(data.collections_index)) {
    errors.push('collections_index must be an array');
  } else {
    collectionCount = data.collections_index.length;
    
    // Validate that referenced collections exist
    data.collections_index.forEach(uid => {
      const collectionKey = `collection_${uid}`;
      if (!data[collectionKey]) {
        errors.push(`Referenced collection ${uid} not found`);
      } else {
        const validation = validateCollection(data[collectionKey]);
        if (!validation.isValid) {
          errors.push(`Collection ${uid}: ${validation.errors.join(', ')}`);
        }
      }
    });
  }
  
  // Validate app metadata
  if (!data.app_metadata) {
    errors.push('Missing app_metadata');
  } else if (typeof data.app_metadata !== 'object') {
    errors.push('app_metadata must be an object');
  } else {
    if (!data.app_metadata.version) {
      errors.push('app_metadata missing version');
    }
    if (typeof data.app_metadata.lastUpdated !== 'number') {
      errors.push('app_metadata missing or invalid lastUpdated');
    }
  }
  
  // Validate user settings
  if (!data.user_settings) {
    errors.push('Missing user_settings');
  } else if (typeof data.user_settings !== 'object') {
    errors.push('user_settings must be an object');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    collectionCount
  };
};

/**
 * Detect and validate current data format
 * @param {object} data - Raw storage data
 * @returns {object} { format: string, isValid: boolean, errors: string[], info: object }
 */
export const detectAndValidateFormat = (data) => {
  if (!data || typeof data !== 'object') {
    return {
      format: 'invalid',
      isValid: false,
      errors: ['Data is not an object'],
      info: {}
    };
  }
  
  // Detect document format (4.0+)
  if (data.collections_index && data.app_metadata) {
    const validation = validateDocumentFormat(data);
    return {
      format: 'document',
      isValid: validation.isValid,
      errors: validation.errors,
      info: {
        version: '4.0+',
        collectionCount: validation.collectionCount
      }
    };
  }
  
  // Detect array format (3.0-3.5)
  if (data.tabsArray) {
    const validation = validateArrayFormat(data);
    
    // Determine sub-version
    let version = '3.0';
    if (data.autoBackups !== undefined || data.preSyncBackups !== undefined) {
      version = '3.5';
    } else if (data.localTimestamp !== undefined) {
      version = '3.0-3.4';
    }
    
    return {
      format: 'array',
      isValid: validation.isValid,
      errors: validation.errors,
      info: {
        version,
        collectionCount: validation.collectionCount,
        hasBackups: !!(data.autoBackups || data.preSyncBackups),
        hasTimestamp: !!data.localTimestamp
      }
    };
  }
  
  // Empty or unknown format
  return {
    format: 'empty',
    isValid: true,
    errors: [],
    info: {
      version: 'new',
      collectionCount: 0
    }
  };
};

/**
 * Generate data integrity report
 * @param {object} data - Data to analyze
 * @returns {object} Comprehensive data report
 */
export const generateDataReport = (data) => {
  const detection = detectAndValidateFormat(data);
  const dataSize = JSON.stringify(data).length;
  
  const report = {
    timestamp: Date.now(),
    format: detection.format,
    version: detection.info.version,
    isValid: detection.isValid,
    errors: detection.errors,
    collections: detection.info.collectionCount,
    dataSize: {
      bytes: dataSize,
      mb: (dataSize / (1024 * 1024)).toFixed(2)
    },
    storageKeys: Object.keys(data),
    hasBackups: detection.info.hasBackups || false
  };
  
  // Add format-specific details
  if (detection.format === 'array') {
    report.arraySpecific = {
      hasLocalTimestamp: !!data.localTimestamp,
      hasAutoBackups: !!data.autoBackups,
      hasPreSyncBackups: !!data.preSyncBackups,
      autoBackupCount: data.autoBackups?.length || 0,
      preSyncBackupCount: data.preSyncBackups?.length || 0
    };
  } else if (detection.format === 'document') {
    report.documentSpecific = {
      indexLength: data.collections_index?.length || 0,
      metadataVersion: data.app_metadata?.version,
      hasUserSettings: !!data.user_settings,
      hasLegacyBackup: !!data._legacy_backup
    };
  }
  
  return report;
};

/**
 * Quick validation check for critical operations
 * @param {object} data - Data to validate
 * @returns {boolean} True if data is safe to use
 */
export const isDataSafe = (data) => {
  try {
    const detection = detectAndValidateFormat(data);
    return detection.isValid && detection.info.collectionCount >= 0;
  } catch (error) {
    console.error('Data safety check failed:', error);
    return false;
  }
}; 