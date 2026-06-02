const {
    SERVER_FILE_TIMESTAMP_STATE,
    fetchServerFileTimestampState,
    getServerFileTimestampOrFalse
} = require('../chrome/sync-transport.js');

const createJsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
});

describe('sync transport module', () => {
    test('returns ok when the sync document includes a timestamp', async () => {
        const fetchImpl = jest.fn(async () => createJsonResponse(200, { timestamp: 9000 }));

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.OK,
            timestamp: 9000
        });
        expect(getServerFileTimestampOrFalse({
            status: SERVER_FILE_TIMESTAMP_STATE.OK,
            timestamp: 9000
        })).toBe(9000);
    });

    test('falls back to modifiedByMeTime when the sync document omits timestamp', async () => {
        const fetchImpl = jest
            .fn()
            .mockImplementationOnce(async () => createJsonResponse(200, { tabsArray: [] }))
            .mockImplementationOnce(async () => createJsonResponse(200, {
                modifiedByMeTime: '1970-01-01T00:00:09.500Z'
            }));

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.OK,
            timestamp: 9500
        });
    });

    test('treats missing files as missing_or_invalid and unavailable responses as false timestamps', async () => {
        const missingFetch = jest.fn(async () => createJsonResponse(404, {}));
        const unavailableFetch = jest.fn(async () => createJsonResponse(503, {}));

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl: missingFetch
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID,
            timestamp: null
        });

        const unavailableResult = await fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl: unavailableFetch
        });

        expect(unavailableResult).toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE,
            timestamp: null
        });
        expect(getServerFileTimestampOrFalse(unavailableResult)).toBe(false);
    });

    test('treats network failures as unavailable', async () => {
        const fetchImpl = jest.fn(async () => {
            throw new Error('Network down');
        });

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE,
            timestamp: null
        });
    });

    test('treats missing file ids, malformed json, and invalid metadata timestamps as missing_or_invalid', async () => {
        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: null,
            fetchImpl: jest.fn()
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID,
            timestamp: null
        });

        const malformedJsonFetch = jest
            .fn()
            .mockImplementationOnce(async () => ({
                ok: true,
                status: 200,
                json: async () => {
                    throw new SyntaxError('bad json');
                }
            }))
            .mockImplementationOnce(async () => createJsonResponse(200, {
                modifiedByMeTime: 'not-a-date'
            }));

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl: malformedJsonFetch
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID,
            timestamp: null
        });
    });

    test('treats metadata fetch failures as unavailable when the fallback request cannot complete', async () => {
        const fetchImpl = jest
            .fn()
            .mockImplementationOnce(async () => createJsonResponse(200, { tabsArray: [] }))
            .mockImplementationOnce(async () => {
                throw new Error('metadata unavailable');
            });

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE,
            timestamp: null
        });
    });

    test('treats metadata 400 responses as missing_or_invalid', async () => {
        const fetchImpl = jest
            .fn()
            .mockImplementationOnce(async () => createJsonResponse(200, { tabsArray: [] }))
            .mockImplementationOnce(async () => createJsonResponse(400, {}));

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id',
            fetchImpl
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID,
            timestamp: null
        });
    });

    test('uses the default fetch implementation when one is not injected', async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(async () => createJsonResponse(200, { timestamp: 777 }));

        await expect(fetchServerFileTimestampState({
            token: 'token-123',
            fileId: 'sync-file-id'
        })).resolves.toEqual({
            status: SERVER_FILE_TIMESTAMP_STATE.OK,
            timestamp: 777
        });

        global.fetch = originalFetch;
    });
});
