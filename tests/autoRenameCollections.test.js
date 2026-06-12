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
            { uid: 'b', reason: 'error', message: 'boom' },
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
        expect(suggestCollectionName).toHaveBeenCalledTimes(1);
    });

    test('AbortError mid-run sets cancelled true and does not record an error skip', async () => {
        const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
        suggestCollectionName
            .mockResolvedValueOnce('New A')
            .mockRejectedValueOnce(abortError);
        const { results, skipped, cancelled } = await autoRenameCollections({ collections });
        expect(cancelled).toBe(true);
        expect(results).toEqual([{ uid: 'a', oldName: 'Old A', newName: 'New A' }]);
        expect(skipped).toEqual([]);
        expect(suggestCollectionName).toHaveBeenCalledTimes(2);
    });

    test('error skip entries carry the error message', async () => {
        suggestCollectionName.mockRejectedValue(new Error('network fail'));
        const { skipped } = await autoRenameCollections({ collections: [collections[0]] });
        expect(skipped).toEqual([{ uid: 'a', reason: 'error', message: 'network fail' }]);
    });

    test('onResult is called per completed item with the right payload', async () => {
        suggestCollectionName
            .mockResolvedValueOnce('New A')
            .mockResolvedValueOnce('Old B')  // unchanged
            .mockRejectedValueOnce(new Error('boom'));
        const onResult = jest.fn();
        await autoRenameCollections({ collections, onResult });
        expect(onResult).toHaveBeenCalledTimes(3);
        expect(onResult).toHaveBeenNthCalledWith(1, { uid: 'a', oldName: 'Old A', newName: 'New A' });
        expect(onResult).toHaveBeenNthCalledWith(2, { uid: 'b', reason: 'unchanged' });
        expect(onResult).toHaveBeenNthCalledWith(3, { uid: 'c', reason: 'error', message: 'boom' });
    });

    test('empty collections array returns empty results immediately', async () => {
        const { results, skipped, cancelled } = await autoRenameCollections({ collections: [] });
        expect(results).toEqual([]);
        expect(skipped).toEqual([]);
        expect(cancelled).toBe(false);
    });

    test('reports progress with index, total, and collection', async () => {
        suggestCollectionName.mockResolvedValue('X');
        const onProgress = jest.fn();
        await autoRenameCollections({ collections, onProgress });
        expect(onProgress).toHaveBeenNthCalledWith(1, 0, 3, collections[0]);
        expect(onProgress).toHaveBeenNthCalledWith(3, 2, 3, collections[2]);
    });
});
