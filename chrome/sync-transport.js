(() => {
const SYNC_ORIGINS = ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'];
const SYNC_PERMISSION_ERROR = 'Google site access is missing. Allow www.googleapis.com and oauth2.googleapis.com in Tabox extension settings, or click Sync to grant access.';

async function hasSyncPermissions(browserApi) {
    if (!browserApi.permissions?.contains) return true;
    try {
        return await browserApi.permissions.contains({ origins: SYNC_ORIGINS });
    } catch {
        return false;
    }
}

// Call before any await in a click handler to preserve Firefox user activation.
async function requestSyncPermissions(browserApi) {
    if (!browserApi.permissions?.request) return true;
    try {
        if (await browserApi.permissions.request({ origins: SYNC_ORIGINS })) return true;
    } catch { /* Surface actionable guidance for browser/policy restrictions too. */ }
    throw new Error(SYNC_PERMISSION_ERROR);
}

const SERVER_FILE_TIMESTAMP_STATE = {
    OK: 'ok',
    MISSING_OR_INVALID: 'missing_or_invalid',
    UNAVAILABLE: 'unavailable'
};

const buildHeaders = (token) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
});

const classifyFailedTimestampLookup = (statusCode) => (
    statusCode === 400 || statusCode === 404
        ? SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID
        : SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE
);

const buildTimestampResult = (status, timestamp = null) => ({
    status,
    timestamp
});

async function safeReadJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function fetchServerFileTimestampState({ token, fileId, fetchImpl = fetch }) {
    if (!fileId) {
        return buildTimestampResult(SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID);
    }

    const init = {
        method: 'GET',
        async: true,
        headers: buildHeaders(token)
    };

    let mediaResponse;
    try {
        mediaResponse = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, init);
    } catch {
        return buildTimestampResult(SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE);
    }

    if (!mediaResponse.ok) {
        return buildTimestampResult(classifyFailedTimestampLookup(mediaResponse.status));
    }

    const mediaData = await safeReadJson(mediaResponse);
    if (mediaData && Number.isFinite(mediaData.timestamp)) {
        return buildTimestampResult(SERVER_FILE_TIMESTAMP_STATE.OK, mediaData.timestamp);
    }

    let metadataResponse;
    try {
        metadataResponse = await fetchImpl(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=json&fields=modifiedByMeTime`,
            init
        );
    } catch {
        return buildTimestampResult(SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE);
    }

    if (!metadataResponse.ok) {
        return buildTimestampResult(classifyFailedTimestampLookup(metadataResponse.status));
    }

    const metadata = await safeReadJson(metadataResponse);
    const timestamp = Date.parse(metadata?.modifiedByMeTime);

    if (!Number.isFinite(timestamp)) {
        return buildTimestampResult(SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID);
    }

    return buildTimestampResult(SERVER_FILE_TIMESTAMP_STATE.OK, timestamp);
}

const syncTransportApi = {
    SYNC_ORIGINS, SYNC_PERMISSION_ERROR, hasSyncPermissions, requestSyncPermissions,
    SERVER_FILE_TIMESTAMP_STATE,
    fetchServerFileTimestampState
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') {
    globalThis.TaboxSyncTransport = syncTransportApi;
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncTransportApi;
}
})();
