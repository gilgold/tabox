jest.mock('../app/ai/tasks/suggestCollectionName', () => ({
    suggestCollectionName: jest.fn(),
}));

import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';
import { autoRenameCollections } from '../app/ai/tasks/autoRenameCollections';

const collections = [
    { uid: 'a', name: 'Old A', tabs: [{}] },
    { uid: 'b', name: 'Old B', tabs: [{}] },
    { uid: 'c', name: 'Old C', tabs: [{}] },
];

describe('autoRenameCollections', () => {
    beforeEach(() => {
        suggestCollectionName.mockReset();
    });

    test('suggests sequentially and collects old/new names', async () => {
        const order = [];
        suggestCollectionName.mockImplementation(async (c) => {
            order.push(c.uid);
            return `New ${c.uid.toUpperCase()}`;
        });
        const { results, skipped, cancelled } = await autoRenameCollections({ collections });
        expect(order).toEqual(['a', 'b', 'c']);
        expect(results).toEqual([
            { uid: 'a', oldName: 'Old A', newName: 'New A' },
            { uid: 'b', oldName: 'Old B', newName: 'New B' },
            { uid: 'c', oldName: 'Old C', newName: 'New C' },
        ]);
        expect(skipped).toEqual([]);
        expect(cancelled).toBe(false);
    });

    test('skips unchanged names and continues after a failure', async () => {
        suggestCollectionName
            .mockResolvedValueOnce('Old A')               // unchanged
            .mockRejectedValueOnce(new Error('boom'))     // error
            .mockResolvedValueOnce('Fresh C');
        const { results, skipped } = await autoRenameCollections({ collections });
        expect(results).toEqual([{ uid: 'c', oldName: 'Old C', newName: 'Fresh C' }]);
        expect(skipped).toEqual([
            { uid: 'a', reason: 'unchanged' },
            { uid: 'b', reason: 'error' },
        ]);
    });

    test('stops when shouldCancel returns true and reports cancelled', async () => {
        suggestCollectionName.mockResolvedValue('Renamed');
        let calls = 0;
        const shouldCancel = () => calls++ >= 1; // false for item 0, true before item 1
        const { results, cancelled } = await autoRenameCollections({ collections, shouldCancel });
        expect(results).toHaveLength(1);
        expect(results[0].uid).toBe('a');
        expect(cancelled).toBe(true);
    });

    test('reports progress with index, total, and collection', async () => {
        suggestCollectionName.mockResolvedValue('X');
        const onProgress = jest.fn();
        await autoRenameCollections({ collections, onProgress });
        expect(onProgress).toHaveBeenNthCalledWith(1, 0, 3, collections[0]);
        expect(onProgress).toHaveBeenNthCalledWith(3, 2, 3, collections[2]);
    });
});
