(() => {
const SYNC_SESSION_STATE_KEY = 'syncSessionState';

const SYNC_SESSION_STATUS = {
    DISABLED: 'disabled',
    AUTH_REFRESHING: 'auth_refreshing',
    ACTIVE: 'active',
    SYNCING: 'syncing',
    AUTH_REQUIRED: 'auth_required',
    SYNC_FILE_ERROR: 'sync_file_error',
    USER_INFO_ERROR: 'user_info_error',
    ERROR: 'error'
};

function createSyncSessionState(overrides = {}) {
    const hasRefreshToken = Boolean(overrides.hasRefreshToken);
    const user = overrides.user || null;
    const status = overrides.status || SYNC_SESSION_STATUS.DISABLED;
    const hasExplicitLastCheckedAt = typeof overrides.lastCheckedAt === 'number';
    const hasOverrides = Object.keys(overrides).length > 0;

    return {
        isEnabled: typeof overrides.isEnabled === 'boolean'
            ? overrides.isEnabled
            : Boolean(hasRefreshToken || user),
        status,
        user,
        hasRefreshToken,
        error: overrides.error || null,
        lastCheckedAt: hasExplicitLastCheckedAt
            ? overrides.lastCheckedAt
            : (hasOverrides ? Date.now() : 0),
        ...overrides
    };
}

async function writeSyncSessionState(storageArea, nextState) {
    const existingState = typeof storageArea.get === 'function'
        ? (await storageArea.get(SYNC_SESSION_STATE_KEY))[SYNC_SESSION_STATE_KEY]
        : null;
    const syncSessionState = createSyncSessionState({
        ...(existingState || {}),
        ...(nextState || {})
    });
    await storageArea.set({
        [SYNC_SESSION_STATE_KEY]: syncSessionState
    });
    return syncSessionState;
}

const syncSessionStateApi = {
    SYNC_SESSION_STATE_KEY,
    SYNC_SESSION_STATUS,
    createSyncSessionState,
    writeSyncSessionState
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') {
    globalThis.TaboxSyncSessionState = syncSessionStateApi;
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncSessionStateApi;
}
})();
