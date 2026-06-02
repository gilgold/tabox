(() => {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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

function getServerFileTimestampOrFalse(result) {
    return result && result.status === SERVER_FILE_TIMESTAMP_STATE.OK ? result.timestamp : false;
}

const syncTransportApi = {
    SERVER_FILE_TIMESTAMP_STATE,
    fetchServerFileTimestampState,
    getServerFileTimestampOrFalse
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
