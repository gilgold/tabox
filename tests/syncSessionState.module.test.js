const {
    SYNC_SESSION_STATE_KEY,
    SYNC_SESSION_STATUS,
    isSyncSessionEnabled,
    createSyncSessionState,
    writeSyncSessionState
} = require('../chrome/sync-session-state.js');

describe('sync session state module', () => {
    test('creates a disabled sync session by default', () => {
        expect(createSyncSessionState()).toEqual({
            isEnabled: false,
            status: SYNC_SESSION_STATUS.DISABLED,
            user: null,
            hasRefreshToken: false,
            error: null,
            lastCheckedAt: 0
        });
    });

    test('treats refresh-token-backed reconnecting sessions as enabled', () => {
        const reconnectingState = createSyncSessionState({
            hasRefreshToken: true,
            status: SYNC_SESSION_STATUS.AUTH_REFRESHING
        });

        expect(isSyncSessionEnabled(reconnectingState)).toBe(true);
    });

    test('infers enabled state from raw session credentials when isEnabled is not set', () => {
        expect(isSyncSessionEnabled({
            hasRefreshToken: true
        })).toBe(true);
    });

    test('treats user-backed sessions as enabled and omitted input as disabled', () => {
        expect(isSyncSessionEnabled({
            user: { displayName: 'Signed In' }
        })).toBe(true);
        expect(isSyncSessionEnabled()).toBe(false);
    });

    test('writes a canonical sync session snapshot to storage', async () => {
        const storageArea = {
            set: jest.fn(async () => {})
        };

        jest.spyOn(Date, 'now').mockReturnValue(12345);

        const writtenState = await writeSyncSessionState(storageArea, {
            hasRefreshToken: true,
            status: SYNC_SESSION_STATUS.AUTH_REFRESHING
        });

        expect(storageArea.set).toHaveBeenCalledWith({
            [SYNC_SESSION_STATE_KEY]: {
                isEnabled: true,
                status: SYNC_SESSION_STATUS.AUTH_REFRESHING,
                user: null,
                hasRefreshToken: true,
                error: null,
                lastCheckedAt: 12345
            }
        });
        expect(writtenState.lastCheckedAt).toBe(12345);

        Date.now.mockRestore();
    });

    test('merges new sync session state with the existing stored snapshot', async () => {
        const storageArea = {
            get: jest.fn(async () => ({
                [SYNC_SESSION_STATE_KEY]: {
                    isEnabled: true,
                    status: SYNC_SESSION_STATUS.ACTIVE,
                    user: { displayName: 'Existing User' },
                    hasRefreshToken: true,
                    error: null,
                    lastCheckedAt: 5000
                }
            })),
            set: jest.fn(async () => {})
        };

        const writtenState = await writeSyncSessionState(storageArea, {
            status: SYNC_SESSION_STATUS.SYNCING,
            error: 'working'
        });

        expect(writtenState).toEqual({
            isEnabled: true,
            status: SYNC_SESSION_STATUS.SYNCING,
            user: { displayName: 'Existing User' },
            hasRefreshToken: true,
            error: 'working',
            lastCheckedAt: expect.any(Number)
        });
    });

    test('writes a disabled default snapshot when no new state is provided', async () => {
        const storageArea = {
            set: jest.fn(async () => {})
        };

        const writtenState = await writeSyncSessionState(storageArea);

        expect(writtenState).toEqual({
            isEnabled: false,
            status: SYNC_SESSION_STATUS.DISABLED,
            user: null,
            hasRefreshToken: false,
            error: null,
            lastCheckedAt: expect.any(Number)
        });
    });
});
