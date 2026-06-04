const {
    validateCollection,
    validateArrayFormat,
    validateDocumentFormat,
    detectAndValidateFormat,
    generateDataReport,
    isDataSafe,
} = require('../app/utils/dataValidation.js');

describe('dataValidation', () => {
    test('accepts a valid collection shape', () => {
        const result = validateCollection({
            uid: 'collection-1',
            name: 'Collection One',
            tabs: [{ uid: 'tab-1', url: 'https://example.com' }],
            chromeGroups: [],
            type: 'collection',
        });

        expect(result).toEqual({
            isValid: true,
            errors: [],
        });
    });

    test('reports missing required collection fields and invalid optional shapes', () => {
        const result = validateCollection({
            uid: 123,
            tabs: [{ title: 'Missing URL and UID' }],
            chromeGroups: {},
            type: 'folder',
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'Collection must have a valid UID',
            'Collection must have a valid name',
            'chromeGroups must be an array if present',
            'Collection type must be "collection"',
            'Tab at index 0 missing UID',
            'Tab at index 0 missing URL',
        ]));
    });

    test('rejects array-format payloads with duplicate UIDs and invalid timestamps', () => {
        const result = validateArrayFormat({
            tabsArray: [
                { uid: 'duplicate', name: 'One', tabs: [] },
                { uid: 'duplicate', name: 'Two', tabs: [] },
            ],
            localTimestamp: 'bad-timestamp',
        });

        expect(result.isValid).toBe(false);
        expect(result.collectionCount).toBe(2);
        expect(result.errors).toEqual(expect.arrayContaining([
            'Duplicate collection UIDs found',
            'localTimestamp must be a number',
        ]));
    });

    test('rejects document-format payloads with missing referenced collections and metadata', () => {
        const result = validateDocumentFormat({
            collections_index: ['collection-1'],
            app_metadata: { lastUpdated: 'bad-value' },
            user_settings: null,
        });

        expect(result.isValid).toBe(false);
        expect(result.collectionCount).toBe(1);
        expect(result.errors).toEqual(expect.arrayContaining([
            'Referenced collection collection-1 not found',
            'app_metadata missing version',
            'app_metadata missing or invalid lastUpdated',
            'Missing user_settings',
        ]));
    });

    test('detects document, array, and empty payloads correctly', () => {
        const documentResult = detectAndValidateFormat({
            collections_index: [],
            app_metadata: { version: '4.0', lastUpdated: Date.now() },
            user_settings: {},
        });
        const arrayResult = detectAndValidateFormat({
            tabsArray: [],
            autoBackups: [],
            localTimestamp: Date.now(),
        });
        const emptyResult = detectAndValidateFormat({});

        expect(documentResult).toEqual(expect.objectContaining({
            format: 'document',
            isValid: true,
            info: expect.objectContaining({
                version: '4.0+',
                collectionCount: 0,
            }),
        }));
        expect(arrayResult).toEqual(expect.objectContaining({
            format: 'array',
            isValid: true,
            info: expect.objectContaining({
                version: '3.5',
                collectionCount: 0,
                hasBackups: true,
                hasTimestamp: true,
            }),
        }));
        expect(emptyResult).toEqual(expect.objectContaining({
            format: 'empty',
            isValid: true,
            info: expect.objectContaining({
                version: 'new',
                collectionCount: 0,
            }),
        }));
    });

    test('builds array-format reports with array-specific metadata', () => {
        const report = generateDataReport({
            tabsArray: [
                {
                    uid: 'collection-1',
                    name: 'Collection One',
                    tabs: [{ uid: 'tab-1', url: 'https://example.com' }],
                },
            ],
            localTimestamp: 123,
            autoBackups: [{ id: 'backup-1' }],
            preSyncBackups: [{ id: 'pre-sync-1' }, { id: 'pre-sync-2' }],
        });

        expect(report).toEqual(expect.objectContaining({
            format: 'array',
            version: '3.5',
            isValid: true,
            collections: 1,
            arraySpecific: {
                hasLocalTimestamp: true,
                hasAutoBackups: true,
                hasPreSyncBackups: true,
                autoBackupCount: 1,
                preSyncBackupCount: 2,
            },
        }));
    });

    test('builds document-format reports with document-specific metadata', () => {
        const report = generateDataReport({
            collections_index: ['collection-1'],
            'collection_collection-1': {
                uid: 'collection-1',
                name: 'Collection One',
                tabs: [{ uid: 'tab-1', url: 'https://example.com' }],
            },
            app_metadata: { version: '4.0', lastUpdated: 123 },
            user_settings: { theme: 'dark' },
            _legacy_backup: true,
        });

        expect(report).toEqual(expect.objectContaining({
            format: 'document',
            version: '4.0+',
            isValid: true,
            documentSpecific: {
                indexLength: 1,
                metadataVersion: '4.0',
                hasUserSettings: true,
                hasLegacyBackup: true,
            },
        }));
    });

    test('returns data safety for valid and invalid payloads', () => {
        const safe = isDataSafe({
            tabsArray: [{ uid: 'collection-1', name: 'Valid', tabs: [] }],
        });
        const unsafe = isDataSafe({
            tabsArray: [{ uid: 'collection-1', tabs: [] }],
        });

        expect(safe).toBe(true);
        expect(unsafe).toBe(false);
    });
});

describe('dataValidation - runtime indexed storage', () => {
    const indexedSnapshot = (overrides = {}) => ({
        collections_index: { c1: { name: 'C1', type: 'collection' } },
        collection_c1: { uid: 'c1', name: 'C1', tabs: [{ uid: 't1', url: 'https://x.com' }] },
        tabox_storage_version: 3,
        ...overrides,
    });

    test('detects the live indexed-storage shape (object index + collection_ records)', () => {
        const result = detectAndValidateFormat(indexedSnapshot());

        expect(result).toEqual(expect.objectContaining({
            format: 'indexed',
            isValid: true,
            info: expect.objectContaining({ version: '4.0+', collectionCount: 1 }),
        }));
    });

    test('isDataSafe stays true even when the legacy tabsArray mirror has an imperfect tab', () => {
        // A restored/loading tab missing a url in the mirror previously failed isDataSafe
        // (document branch never matched, so the strict tabsArray branch ran) and aborted
        // the migration into a destructive rollback.
        const data = indexedSnapshot({
            tabsArray: [{ uid: 'c1', name: 'C1', tabs: [{ title: 'still loading, no url yet' }] }],
        });

        expect(detectAndValidateFormat(data).format).toBe('indexed');
        expect(isDataSafe(data)).toBe(true);
    });

    test('flags structurally broken indexed records', () => {
        const result = detectAndValidateFormat({
            collections_index: { c1: { name: 'C1' } },
            collection_c1: { uid: 'c1', tabs: 'not-an-array' },
        });

        expect(result.format).toBe('indexed');
        expect(result.isValid).toBe(false);
    });

    test('still recognizes the export document format (array index + app_metadata)', () => {
        const result = detectAndValidateFormat({
            collections_index: [],
            app_metadata: { version: '4.0', lastUpdated: Date.now() },
            user_settings: {},
        });

        expect(result.format).toBe('document');
    });
});
