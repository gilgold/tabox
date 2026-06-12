import { suggestCollectionName } from './suggestCollectionName';

// Suggests new names for collections one at a time. AI inference and the
// surrounding session lifecycle are strictly sequential — Gemini Nano handles
// one prompt at a time, and per-item storage writes are forbidden in parallel
// anyway (apply happens in one batch after this returns).
export async function autoRenameCollections({ collections, onProgress, onResult, shouldCancel, signal }) {
    const results = [];
    const skipped = [];
    let cancelled = false;

    for (let index = 0; index < collections.length; index++) {
        if ((shouldCancel && shouldCancel()) || signal?.aborted) {
            cancelled = true;
            break;
        }
        const collection = collections[index];
        if (onProgress) onProgress(index, collections.length, collection);
        try {
            const newName = await suggestCollectionName(collection, { signal });
            if (newName && newName !== collection.name) {
                const entry = { uid: collection.uid, oldName: collection.name, newName };
                results.push(entry);
                if (onResult) onResult(entry);
            } else {
                const entry = { uid: collection.uid, reason: 'unchanged' };
                skipped.push(entry);
                if (onResult) onResult(entry);
            }
        } catch (error) {
            if (error?.name === 'AbortError') {
                cancelled = true;
                break;
            }
            console.error('Tabox AI: rename suggestion failed for', collection.uid, error);
            const entry = { uid: collection.uid, reason: 'error', message: error?.message };
            skipped.push(entry);
            if (onResult) onResult(entry);
        }
    }

    return { results, skipped, cancelled };
}
