import {
    buildLegacyImportPreview,
    buildLegacyImportPayloadFromSelection,
} from '../app/utils/legacyImportPreview';

describe('legacyImportPreview', () => {
    test('builds grouped preview sections for full exports', () => {
        const preview = buildLegacyImportPreview({
            type: 'full_export',
            folders: [
                { uid: 'folder-1', name: 'Team' },
            ],
            collections: [
                { uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [{ title: 'A' }], chromeGroups: [] },
                { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [{ title: 'B' }], chromeGroups: [{ title: 'Group' }] },
            ],
        });

        expect(preview.sections).toEqual([
            expect.objectContaining({
                id: 'folder:folder-1',
                title: 'Team',
                collections: [expect.objectContaining({ name: 'Alpha' })],
            }),
            expect.objectContaining({
                id: 'root',
                title: 'No Folder',
                collections: [expect.objectContaining({ name: 'Beta' })],
            }),
        ]);
        expect(preview.collections).toHaveLength(2);
    });

    test('filters full exports down to selected collections and referenced folders', () => {
        const preview = buildLegacyImportPreview({
            type: 'full_export',
            folders: [
                { uid: 'folder-1', name: 'Team' },
                { uid: 'folder-2', name: 'Unused' },
            ],
            collections: [
                { uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] },
                { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [], chromeGroups: [] },
            ],
        });

        const filteredPayload = buildLegacyImportPayloadFromSelection({
            parsedImportData: preview.parsedImportData,
            selectedCollectionIds: [preview.collections[0].previewId],
            allPreviewCollections: preview.collections,
        });

        expect(filteredPayload).toEqual(expect.objectContaining({
            type: 'full_export',
            collections: [expect.objectContaining({ name: 'Alpha' })],
            folders: [expect.objectContaining({ uid: 'folder-1' })],
        }));
    });

    test('keeps the folder wrapper for folder exports when at least one nested collection is selected', () => {
        const preview = buildLegacyImportPreview({
            type: 'folder',
            folder: { uid: 'folder-1', name: 'Shared Folder' },
            collections: [
                { uid: 'collection-1', name: 'Alpha', tabs: [], chromeGroups: [] },
                { uid: 'collection-2', name: 'Beta', tabs: [], chromeGroups: [] },
            ],
        });

        const filteredPayload = buildLegacyImportPayloadFromSelection({
            parsedImportData: preview.parsedImportData,
            selectedCollectionIds: [preview.collections[1].previewId],
            allPreviewCollections: preview.collections,
        });

        expect(filteredPayload).toEqual({
            type: 'folder',
            folder: expect.objectContaining({ name: 'Shared Folder' }),
            collections: [expect.objectContaining({ name: 'Beta' })],
        });
    });

    test('builds a single preview row for single-collection txt imports', () => {
        const preview = buildLegacyImportPreview({
            name: 'Solo',
            tabs: [{ title: 'Docs' }],
            chromeGroups: [],
        });

        expect(preview.collections).toEqual([
            expect.objectContaining({
                name: 'Solo',
                tabCount: 1,
                groupCount: 0,
            }),
        ]);
        expect(preview.sections).toEqual([
            expect.objectContaining({
                id: 'root',
                collections: [expect.objectContaining({ name: 'Solo' })],
            }),
        ]);
    });
});
