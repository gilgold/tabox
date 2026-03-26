export const MIGRATION_SUPPORT_40 = {
    CURRENT_VERSION: '4.0',
    SUPPORTED_VERSION: '4.0'
};

const COLLECTION_PREFIX = 'collection_';
const FOLDER_PREFIX = 'folder_';

const hasIndexed40Storage = (data) => (
    Number.isFinite(data.tabox_storage_version) ||
    Boolean(data.collections_index) ||
    Boolean(data.folders_index) ||
    Object.keys(data).some((key) => key.startsWith(COLLECTION_PREFIX) || key.startsWith(FOLDER_PREFIX))
);

const hasLegacyArrayOnlyData = (data) => (
    Array.isArray(data.tabsArray) &&
    !hasIndexed40Storage(data)
);

const hasMissingTimestampFields = (data) => (
    Object.entries(data).some(([key, value]) => {
        if (!key.startsWith(COLLECTION_PREFIX) && !key.startsWith(FOLDER_PREFIX)) {
            return false;
        }

        return value && value.lastUpdated === undefined;
    })
);

const hasLegacyColorValues = (data) => (
    Object.entries(data).some(([key, value]) => (
        (key.startsWith(COLLECTION_PREFIX) || key.startsWith(FOLDER_PREFIX)) &&
        typeof value?.color === 'string' &&
        value.color.startsWith('#')
    ))
);

export const assessMigrationSupport40 = (data = {}) => {
    if (hasLegacyArrayOnlyData(data)) {
        return {
            currentVersion: 'pre-4.0',
            supported: false,
            migrationNeeded: false,
            migrationPath: [],
            unsupportedReason: 'pre_4_runtime_data'
        };
    }

    if (!hasIndexed40Storage(data)) {
        return {
            currentVersion: MIGRATION_SUPPORT_40.CURRENT_VERSION,
            supported: true,
            migrationNeeded: false,
            migrationPath: [],
            unsupportedReason: null
        };
    }

    const migrationPath = [];

    if (hasLegacyColorValues(data)) {
        migrationPath.push('color_migration');
    }

    if (hasMissingTimestampFields(data)) {
        migrationPath.push('timestamp_migration');
    }

    return {
        currentVersion: MIGRATION_SUPPORT_40.CURRENT_VERSION,
        supported: true,
        migrationNeeded: migrationPath.length > 0,
        migrationPath,
        unsupportedReason: null
    };
};
