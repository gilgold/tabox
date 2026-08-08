import { browser } from '../../static/globals';
import { batchUpdateCollections } from './storageUtils';
import { getDisplayInfo } from './displayInfo';

const hasVisibleIntersection = (targetBounds, displayBounds) => {
    const intersection = {
        top: Math.max(displayBounds.top, targetBounds.top),
        left: Math.max(displayBounds.left, targetBounds.left),
        bottom: Math.min(displayBounds.top + displayBounds.height, targetBounds.top + targetBounds.height),
        right: Math.min(displayBounds.left + displayBounds.width, targetBounds.left + targetBounds.width),
    };

    const width = intersection.right - intersection.left;
    const height = intersection.bottom - intersection.top;

    if (width <= 0 || height <= 0) {
        return false;
    }

    return (width * height) / (targetBounds.width * targetBounds.height) >= 0.5;
};

const buildWindowCreationObject = (collection, displays = []) => {
    let windowCreationObject = { focused: true };

    if (!collection?.window) {
        return windowCreationObject;
    }

    const targetBounds = {
        top: Math.round(collection.window.top),
        left: Math.round(collection.window.left),
        width: Math.round(collection.window.width),
        height: Math.round(collection.window.height),
    };

    const isPositionValid = displays.some((display) => hasVisibleIntersection(targetBounds, display.bounds));

    if (isPositionValid) {
        return { ...windowCreationObject, ...targetBounds };
    }

    return {
        ...windowCreationObject,
        width: targetBounds.width,
        height: targetBounds.height,
    };
};

export const openCollectionsInSequence = async (collections = []) => {
    const openedCollections = [];
    const failedCollections = [];
    const displays = await getDisplayInfo();

    for (const collection of collections) {
        try {
            const win = await browser.windows.create(buildWindowCreationObject(collection, displays));
            await browser.runtime.sendMessage({
                type: 'openTabs',
                collection,
                window: win,
            });
            openedCollections.push({
                ...collection,
                lastOpened: Date.now(),
            });
        } catch {
            failedCollections.push(collection?.name || 'Untitled Collection');
        }
    }

    if (openedCollections.length > 0) {
        await batchUpdateCollections(openedCollections);
    }

    return {
        openedCollections,
        failedCollections,
        openedCount: openedCollections.length,
        failedCount: failedCollections.length,
    };
};

export const buildCollectionSubsetExport = ({
    collections = [],
    folders = [],
} = {}) => {
    const folderIds = new Set(
        collections
            .map((collection) => collection?.parentId || null)
            .filter(Boolean),
    );

    const referencedFolders = folders.filter((folder) => folderIds.has(folder.uid));

    return {
        type: 'full_export',
        collections,
        folders: referencedFolders,
        exportedAt: new Date().toISOString(),
        version: '2.0',
        stats: {
            totalCollections: collections.length,
            totalFolders: referencedFolders.length,
            collectionsInFolders: collections.filter((collection) => !!collection.parentId).length,
            rootCollections: collections.filter((collection) => !collection.parentId).length,
        },
    };
};
