import { suggestCollectionName } from './suggestCollectionName';

// Suggests new names for collections one at a time. AI inference and the
// surrounding session lifecycle are strictly sequential — Gemini Nano handles
// one prompt at a time, and per-item storage writes are forbidden in parallel
// anyway (apply happens in one batch after this returns).
export async function autoRenameCollections({ collections, onProgress, shouldCancel }) {
    const results = [];
    const skipped = [];
    let cancelled = false;

    for (let index = 0; index < collections.length; index++) {
        if (shouldCancel && shouldCancel()) {
            cancelled = true;
            break;
        }
        const collection = collections[index];
        if (onProgress) onProgress(index, collections.length, collection);
        try {
            const newName = await suggestCollectionName(collection);
            if (newName && newName !== collection.name) {
                results.push({ uid: collection.uid, oldName: collection.name, newName });
            } else {
                skipped.push({ uid: collection.uid, reason: 'unchanged' });
            }
        } catch (error) {
            console.error('Tabox AI: rename suggestion failed for', collection.uid, error);
            skipped.push({ uid: collection.uid, reason: 'error' });
        }
    }

    return { results, skipped, cancelled };
}
