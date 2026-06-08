import { snapshotShape, verifyMigrationInvariant } from '../app/utils/migrationInvariant';

const coll = (uid, tabs = 0, groups = 0) => ({
    uid,
    tabs: Array.from({ length: tabs }, (_, i) => ({ url: `u${i}` })),
    chromeGroups: Array.from({ length: groups }, (_, i) => ({ id: i })),
});

describe('verifyMigrationInvariant', () => {
    test('passes when nothing is lost or shrunk', () => {
        const before = snapshotShape([coll('a', 2), coll('b', 1)], [{ uid: 'f1' }]);
        const after = snapshotShape([coll('a', 2), coll('b', 1)], [{ uid: 'f1' }]);
        expect(verifyMigrationInvariant(before, after).ok).toBe(true);
    });

    test('passes when collections or tabs are ADDED', () => {
        const before = snapshotShape([coll('a', 2)], []);
        const after = snapshotShape([coll('a', 3), coll('b', 1)], [{ uid: 'f1' }]);
        expect(verifyMigrationInvariant(before, after).ok).toBe(true);
    });

    test('fails when a collection uid disappears', () => {
        const before = snapshotShape([coll('a', 2), coll('b', 1)], []);
        const after = snapshotShape([coll('a', 2)], []);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'collection_lost', uid: 'b' });
    });

    test('fails when a collection tab count shrinks', () => {
        const before = snapshotShape([coll('a', 5)], []);
        const after = snapshotShape([coll('a', 2)], []);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'tabs_shrunk', uid: 'a', before: 5, after: 2 });
    });

    test('fails when chromeGroups shrink', () => {
        const before = snapshotShape([coll('a', 2, 3)], []);
        const after = snapshotShape([coll('a', 2, 1)], []);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'groups_shrunk', uid: 'a', before: 3, after: 1 });
    });

    test('fails when a folder uid disappears', () => {
        const before = snapshotShape([], [{ uid: 'f1' }, { uid: 'f2' }]);
        const after = snapshotShape([], [{ uid: 'f1' }]);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'folder_lost', uid: 'f2' });
    });
});
