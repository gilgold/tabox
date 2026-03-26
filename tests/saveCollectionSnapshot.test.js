import { buildCollectionFromSnapshot, buildSnapshotFromSessionSelections } from '../app/utils/saveCollectionSnapshot';

describe('saveCollectionSnapshot helpers', () => {
    test('builds a combined snapshot from selected tab sessions in order', () => {
        const snapshot = buildSnapshotFromSessionSelections({
            snapshots: [
                {
                    name: 'First tab',
                    tabs: [{ uid: 'tab-1', title: 'First', url: 'https://example.com/first' }],
                    chromeGroups: [],
                },
                {
                    name: 'Second tab',
                    tabs: [{ uid: 'tab-2', title: 'Second', url: 'https://example.com/second' }],
                    chromeGroups: [],
                },
            ],
        });

        expect(snapshot.name).toBe('2 recently closed tabs');
        expect(snapshot.chromeGroups).toEqual([]);
        expect(snapshot.tabs.map((tab) => tab.title)).toEqual(['First', 'Second']);
    });

    test('buildCollectionFromSnapshot creates a new saved collection', () => {
        const collection = buildCollectionFromSnapshot({
            snapshot: {
                uid: 'session-1',
                name: 'Original',
                tabs: [{ uid: 'tab-1', title: 'First', url: 'https://example.com/first' }],
                chromeGroups: [],
            },
            name: 'Saved copy',
        });

        expect(collection.name).toBe('Saved copy');
        expect(collection.uid).not.toBe('session-1');
    });
});
