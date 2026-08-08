import { applyUid } from '../utils';
import { unwrapDeferredUrl } from './urlUtils';
import { browser } from '../../static/globals';

export function buildCollectionFromSnapshot({ snapshot, name, parentId = '' } = {}) {
    const extensionOrigin = browser.runtime.getURL('');
    const nextSnapshot = {
        ...snapshot,
        name,
        // Resolve any deferred-loading wrapper URLs so we never persist the placeholder
        // page (chrome-extension://.../deferedLoading.html) as a saved tab URL.
        // Also filter out any extension URLs (they cannot be opened from the popup context).
        tabs: (snapshot.tabs || []).map((tab) => {
            const unwrapped = unwrapDeferredUrl(tab.url);
            // Filter out extension URLs (e.g., chrome-extension:// or moz-extension://)
            if (unwrapped?.startsWith(extensionOrigin)) {
                return null;
            }
            return { ...tab, url: unwrapped };
        }).filter(Boolean),
        chromeGroups: (snapshot.chromeGroups || []).map((group) => ({ ...group })),
        createdOn: Date.now(),
        lastUpdated: Date.now(),
    };

    delete nextSnapshot.windowId;
    delete nextSnapshot.isFocused;
    delete nextSnapshot.isCurrentWindow;
    delete nextSnapshot.uid;
    delete nextSnapshot.sessionId;
    delete nextSnapshot.sessionEntryKey;
    delete nextSnapshot.sourceType;

    if (parentId) {
        nextSnapshot.parentId = parentId;
    } else {
        delete nextSnapshot.parentId;
    }

    return applyUid(nextSnapshot);
}

export function buildSnapshotFromSessionSelections({ snapshots = [], name } = {}) {
    const orderedSnapshots = (snapshots || []).filter(Boolean);
    const tabs = orderedSnapshots.flatMap((snapshot) => (
        (snapshot.tabs || []).map((tab) => ({ ...tab }))
    ));

    return {
        name: name || `${tabs.length} recently closed tab${tabs.length !== 1 ? 's' : ''}`,
        tabs,
        chromeGroups: [],
        createdOn: Date.now(),
        lastUpdated: Date.now(),
    };
}

export async function saveCollectionSnapshot({
    snapshot,
    name,
    parentId = '',
    addCollection,
    onDataUpdate,
    onSaved,
}) {
    const newCollection = buildCollectionFromSnapshot({
        snapshot,
        name,
        parentId,
    });
    const success = await addCollection(newCollection, false, true);

    if (!success) {
        throw new Error('Failed to save collection');
    }

    if (onDataUpdate) {
        await onDataUpdate();
    }

    if (onSaved) {
        onSaved(newCollection);
    }

    return newCollection;
}
