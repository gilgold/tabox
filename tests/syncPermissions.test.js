const { hasSyncPermissions, requestSyncPermissions, SYNC_ORIGINS } = require('../chrome/sync-transport');

describe('Google sync host permissions', () => {
    test('checks both hosts and handles unavailable APIs', async () => {
        const contains = jest.fn().mockResolvedValue(false);
        expect(await hasSyncPermissions({ permissions: { contains } })).toBe(false);
        expect(contains).toHaveBeenCalledWith({ origins: SYNC_ORIGINS });
        contains.mockResolvedValue(true);
        expect(await hasSyncPermissions({ permissions: { contains } })).toBe(true);
        contains.mockRejectedValue(new Error('unavailable'));
        expect(await hasSyncPermissions({ permissions: { contains } })).toBe(false);
        expect(await hasSyncPermissions({})).toBe(true);
    });
    test('requests synchronously in the user gesture and rejects denial or errors', async () => {
        const request = jest.fn().mockResolvedValue(true);
        const result = requestSyncPermissions({ permissions: { request } });
        expect(request).toHaveBeenCalledWith({ origins: SYNC_ORIGINS });
        expect(await result).toBe(true);
        request.mockResolvedValue(false);
        await expect(requestSyncPermissions({ permissions: { request } })).rejects.toThrow('Google site access');
        request.mockRejectedValue(new Error('browser error'));
        await expect(requestSyncPermissions({ permissions: { request } })).rejects.toThrow('Google site access');
        expect(await requestSyncPermissions({})).toBe(true);
    });
});
