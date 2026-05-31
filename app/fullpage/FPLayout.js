import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    detailPanelOpenState,
    selectedCollectionUidState,
    selectedCurrentWindowIdState,
    selectedSessionEntryKeyState,
} from '../atoms/globalAppSettingsState';
import { collectionRevealBatchState } from '../atoms/animationsState';
import { browserSessionsState, currentWindowsState, sidebarNavigationState } from '../atoms/fullpageState';
import FPTopBar from './FPTopBar';
import FPSidebar from './FPSidebar';
import FPContentArea from './FPContentArea';
import CollectionDetailPanel from '../CollectionDetailPanel';
import FPCurrentWindowPanel from './FPCurrentWindowPanel';
import FPSessionPanel from './FPSessionPanel';
import SaveCollectionModal from './SaveCollectionModal';
import CurrentWindowCloseModal from './CurrentWindowCloseModal';
import { browser } from '../../static/globals';
import { loadCurrentWindowsSnapshots } from '../utils/currentWindows';
import {
    getBrowserSessionCount,
    getBrowserSessionEntryKey,
    loadBrowserSessions,
    subscribeToBrowserSessions,
} from '../utils/browserSessions';
import { showErrorToast } from '../toastHelpers';
import './FPLayout.css';

const buildRevealBatchPayload = (collectionsToReveal) => {
    const entries = Array.isArray(collectionsToReveal)
        ? collectionsToReveal
        : collectionsToReveal
        ? [collectionsToReveal]
        : [];
    const items = entries
        .map((item) => {
            if (!item?.uid) {
                return null;
            }

            return {
                uid: item.uid,
                parentId: item.parentId || null,
            };
        })
        .filter(Boolean);

    if (items.length === 0) {
        return null;
    }

    return {
        runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        items,
    };
};

function FPLayout({
    folders,
    collections,
    allCollections,
    logout,
    applyDataFromServer,
    updateRemoteData,
    addCollection,
    removeCollection,
    updateCollection,
    addFolder,
    onFolderOptimisticUpdate,
    onDataUpdate,
    onFolderStateChange,
    updateFolders,
    triggerSync,
    viewMode,
    sortValue,
    onViewModeChange,
    onFiltersChange,
    filters,
    hasActiveFilters,
    lightningEffectFolderUid,
    triggerFolderLightningEffect,
    trackedCollectionUids,
    listKey,
}) {
    const isPanelOpen = useAtomValue(detailPanelOpenState);
    const selectedCollectionUid = useAtomValue(selectedCollectionUidState);
    const [selectedCurrentWindowId, setSelectedCurrentWindowId] = useAtom(selectedCurrentWindowIdState);
    const [selectedSessionEntryKey, setSelectedSessionEntryKey] = useAtom(selectedSessionEntryKeyState);
    const [currentWindows, setCurrentWindows] = useAtom(currentWindowsState);
    const [browserSessions, setBrowserSessions] = useAtom(browserSessionsState);
    const [sidebarNavigation, setSidebarNavigation] = useAtom(sidebarNavigationState);
    const setDetailPanelOpen = useSetAtom(detailPanelOpenState);
    const setSelectedCollectionUid = useSetAtom(selectedCollectionUidState);
    const setCollectionRevealBatch = useSetAtom(collectionRevealBatchState);
    const [saveCurrentWindowTarget, setSaveCurrentWindowTarget] = useState(null);
    const [closeCurrentWindowTarget, setCloseCurrentWindowTarget] = useState(null);

    const queueRevealBatch = useCallback((collectionsToReveal) => {
        const payload = buildRevealBatchPayload(collectionsToReveal);
        if (payload) {
            setCollectionRevealBatch(payload);
        }
    }, [setCollectionRevealBatch]);

    useEffect(() => {
        if (sidebarNavigation === 'recent') {
            setSidebarNavigation('all');
        }
    }, [setSidebarNavigation, sidebarNavigation]);

    const selectedCollection = useMemo(() => {
        if (!selectedCollectionUid) return null;
        const allCols = allCollections || collections;
        return allCols.find(c => c.uid === selectedCollectionUid) || null;
    }, [selectedCollectionUid, allCollections, collections]);

    const refreshBrowserSessions = useCallback(async () => {
        const sessions = await loadBrowserSessions();
        setBrowserSessions(sessions);
        return sessions;
    }, [setBrowserSessions]);

    const refreshCurrentWindows = useCallback(async () => {
        try {
            const snapshots = await loadCurrentWindowsSnapshots();
            setCurrentWindows(snapshots);
            return snapshots;
        } catch {
            setCurrentWindows([]);
            return [];
        }
    }, [setCurrentWindows]);

    useEffect(() => {
        let isMounted = true;

        const refresh = async () => {
            try {
                const sessions = await loadBrowserSessions();
                if (isMounted) {
                    setBrowserSessions(sessions);
                }
            } catch {
                if (isMounted) {
                    setBrowserSessions([]);
                }
            }
        };

        refresh();
        const unsubscribe = subscribeToBrowserSessions(refresh);

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [setBrowserSessions]);

    useEffect(() => {
        if (sidebarNavigation !== 'current-windows' && !selectedCurrentWindowId) {
            return undefined;
        }

        let isMounted = true;
        let refreshTimeout = null;

        const refresh = async () => {
            try {
                const snapshots = await loadCurrentWindowsSnapshots();
                if (isMounted) {
                    setCurrentWindows(snapshots);
                }
            } catch {
                if (isMounted) {
                    setCurrentWindows([]);
                }
            }
        };

        const scheduleRefresh = () => {
            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }
            refreshTimeout = setTimeout(() => {
                refresh();
            }, 50);
        };

        const listenerBindings = [
            [browser.windows?.onCreated, scheduleRefresh],
            [browser.windows?.onRemoved, scheduleRefresh],
            [browser.windows?.onFocusChanged, scheduleRefresh],
            [browser.windows?.onBoundsChanged, scheduleRefresh],
            [browser.tabs?.onCreated, scheduleRefresh],
            [browser.tabs?.onRemoved, scheduleRefresh],
            [browser.tabs?.onUpdated, scheduleRefresh],
            [browser.tabs?.onMoved, scheduleRefresh],
            [browser.tabs?.onAttached, scheduleRefresh],
            [browser.tabs?.onDetached, scheduleRefresh],
            [browser.tabGroups?.onCreated, scheduleRefresh],
            [browser.tabGroups?.onUpdated, scheduleRefresh],
            [browser.tabGroups?.onMoved, scheduleRefresh],
            [browser.tabGroups?.onRemoved, scheduleRefresh],
        ];

        refresh();

        listenerBindings.forEach(([eventSource, listener]) => {
            eventSource?.addListener?.(listener);
        });

        return () => {
            isMounted = false;
            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }
            listenerBindings.forEach(([eventSource, listener]) => {
                eventSource?.removeListener?.(listener);
            });
        };
    }, [selectedCurrentWindowId, setCurrentWindows, sidebarNavigation]);

    useEffect(() => {
        if (sidebarNavigation === 'current-windows') {
            return;
        }

        if (!selectedCurrentWindowId) {
            return;
        }

        setSelectedCurrentWindowId(null);
        setDetailPanelOpen(false);
    }, [selectedCurrentWindowId, setDetailPanelOpen, setSelectedCurrentWindowId, sidebarNavigation]);

    useEffect(() => {
        if (sidebarNavigation === 'sessions') {
            return;
        }

        if (!selectedSessionEntryKey) {
            return;
        }

        setSelectedSessionEntryKey(null);
        setDetailPanelOpen(false);
    }, [selectedSessionEntryKey, setDetailPanelOpen, setSelectedSessionEntryKey, sidebarNavigation]);

    useEffect(() => {
        if (!selectedCurrentWindowId) {
            return;
        }

        if (currentWindows.some((windowSnapshot) => windowSnapshot.windowId === selectedCurrentWindowId)) {
            return;
        }

        setSelectedCurrentWindowId(null);
        setCloseCurrentWindowTarget(null);
        if (!selectedCollectionUid) {
            setDetailPanelOpen(false);
        }
    }, [currentWindows, selectedCollectionUid, selectedCurrentWindowId, setDetailPanelOpen, setSelectedCurrentWindowId]);

    const selectedCurrentWindow = useMemo(() => {
        if (!selectedCurrentWindowId) {
            return null;
        }

        return currentWindows.find((windowSnapshot) => windowSnapshot.windowId === selectedCurrentWindowId) || null;
    }, [currentWindows, selectedCurrentWindowId]);

    const selectedSessionEntry = useMemo(() => {
        if (!selectedSessionEntryKey) {
            return null;
        }

        for (const session of browserSessions) {
            for (const collection of session.collections || []) {
                if (
                    collection?.sourceType === 'window' &&
                    getBrowserSessionEntryKey(collection, session.timestamp) === selectedSessionEntryKey
                ) {
                    return {
                        collection,
                        sessionTimestamp: session.timestamp,
                    };
                }
            }
        }

        return null;
    }, [browserSessions, selectedSessionEntryKey]);

    useEffect(() => {
        if (!selectedSessionEntryKey) {
            return;
        }

        if (selectedSessionEntry) {
            return;
        }

        setSelectedSessionEntryKey(null);
        if (!selectedCollectionUid && !selectedCurrentWindowId) {
            setDetailPanelOpen(false);
        }
    }, [
        selectedCollectionUid,
        selectedCurrentWindowId,
        selectedSessionEntryKey,
        selectedSessionEntry,
        setDetailPanelOpen,
        setSelectedSessionEntryKey,
    ]);

    const handleClosePanel = () => {
        setDetailPanelOpen(false);
        setSelectedCollectionUid(null);
        setSelectedCurrentWindowId(null);
        setSelectedSessionEntryKey(null);
    };

    const handleSelectCurrentWindow = useCallback((windowSnapshot) => {
        setSelectedCollectionUid(null);
        setSelectedSessionEntryKey(null);
        setSelectedCurrentWindowId(windowSnapshot.windowId);
        setDetailPanelOpen(true);
    }, [setDetailPanelOpen, setSelectedCollectionUid, setSelectedCurrentWindowId, setSelectedSessionEntryKey]);

    const handleSelectSession = useCallback((collection, sessionTimestamp) => {
        setSelectedCollectionUid(null);
        setSelectedCurrentWindowId(null);
        setSelectedSessionEntryKey(getBrowserSessionEntryKey(collection, sessionTimestamp));
        setDetailPanelOpen(true);
    }, [setDetailPanelOpen, setSelectedCollectionUid, setSelectedCurrentWindowId, setSelectedSessionEntryKey]);

    const handleFocusCurrentWindow = useCallback(async (windowSnapshot) => {
        try {
            await browser.runtime.sendMessage({
                type: 'focusWindow',
                windowId: windowSnapshot.windowId,
            });
            await refreshCurrentWindows();
        } catch (error) {
            showErrorToast(`Failed to focus window: ${error.message}`);
        }
    }, [refreshCurrentWindows]);

    const handleSaveCurrentWindow = useCallback((windowSnapshot) => {
        setSaveCurrentWindowTarget(windowSnapshot);
    }, []);

    const handleRequestCloseCurrentWindow = useCallback((windowSnapshot) => {
        setCloseCurrentWindowTarget(windowSnapshot);
    }, []);

    const handleCurrentWindowClosed = useCallback(async (windowId) => {
        setCloseCurrentWindowTarget(null);
        if (selectedCurrentWindowId === windowId) {
            setSelectedCurrentWindowId(null);
            if (!selectedCollectionUid) {
                setDetailPanelOpen(false);
            }
        }
        await refreshCurrentWindows();
    }, [
        refreshCurrentWindows,
        selectedCollectionUid,
        selectedCurrentWindowId,
        setDetailPanelOpen,
        setSelectedCurrentWindowId,
    ]);

    const browserSessionCount = useMemo(() => getBrowserSessionCount(browserSessions), [browserSessions]);
    const shouldShowDetailPanel = isPanelOpen && !!(selectedCurrentWindow || selectedSessionEntry || selectedCollection);

    return (
        <div className="fp-layout">
            <FPTopBar
                logout={logout}
                applyDataFromServer={applyDataFromServer}
                updateRemoteData={updateRemoteData}
                onDataUpdate={onDataUpdate}
                triggerSync={triggerSync}
            />

            <div className={`fp-body ${shouldShowDetailPanel ? 'fp-body-panel-open' : ''}`}>
                <FPSidebar
                    folders={folders}
                    collections={allCollections || collections}
                    sessionCount={browserSessionCount}
                    addCollection={addCollection}
                    addFolder={addFolder}
                    onFolderOptimisticUpdate={onFolderOptimisticUpdate}
                    onDataUpdate={onDataUpdate}
                    updateFolders={updateFolders}
                    triggerSync={triggerSync}
                    triggerFolderLightningEffect={triggerFolderLightningEffect}
                    onCollectionsRevealed={queueRevealBatch}
                />

                <FPContentArea
                    key={`fp-content-${listKey}`}
                    collections={collections}
                    currentWindows={currentWindows}
                    sessionList={browserSessions}
                    folders={folders}
                    updateCollection={updateCollection}
                    removeCollection={removeCollection}
                    addCollection={addCollection}
                    addFolder={addFolder}
                    updateRemoteData={updateRemoteData}
                    onFolderOptimisticUpdate={onFolderOptimisticUpdate}
                    onDataUpdate={onDataUpdate}
                    triggerSync={triggerSync}
                    filters={filters}
                    hasActiveFilters={hasActiveFilters}
                    triggerFolderLightningEffect={triggerFolderLightningEffect}
                    trackedCollectionUids={trackedCollectionUids}
                    viewMode={viewMode}
                    onViewModeChange={onViewModeChange}
                    onFiltersChange={onFiltersChange}
                    onFolderStateChange={onFolderStateChange}
                    onSelectCurrentWindow={handleSelectCurrentWindow}
                    onFocusCurrentWindow={handleFocusCurrentWindow}
                    onSaveCurrentWindow={handleSaveCurrentWindow}
                    onCloseCurrentWindow={handleRequestCloseCurrentWindow}
                    onSelectSession={handleSelectSession}
                />

                <div
                    className={`fp-detail-panel ${shouldShowDetailPanel ? 'open' : ''}`}
                    aria-hidden={!shouldShowDetailPanel}
                >
                    {selectedCurrentWindow && (
                        <FPCurrentWindowPanel
                            windowSnapshot={selectedCurrentWindow}
                            isOpen={isPanelOpen}
                            onClose={handleClosePanel}
                            onFocusWindow={handleFocusCurrentWindow}
                            onSaveAsCollection={handleSaveCurrentWindow}
                            onCloseWindow={handleRequestCloseCurrentWindow}
                            onTabsChanged={refreshCurrentWindows}
                        />
                    )}

                    {!selectedCurrentWindow && selectedSessionEntry && (
                        <FPSessionPanel
                            sessionCollection={selectedSessionEntry.collection}
                            sessionTimestamp={selectedSessionEntry.sessionTimestamp}
                            isOpen={isPanelOpen}
                            onClose={handleClosePanel}
                            onSaveAsCollection={setSaveCurrentWindowTarget}
                            onRestoreWindow={refreshBrowserSessions}
                        />
                    )}

                    {!selectedCurrentWindow && !selectedSessionEntry && selectedCollection && (
                        <CollectionDetailPanel
                            collection={selectedCollection}
                            isOpen={isPanelOpen}
                            onClose={handleClosePanel}
                            updateCollection={updateCollection}
                            removeCollection={removeCollection}
                            updateRemoteData={updateRemoteData}
                            addCollection={addCollection}
                            onDataUpdate={onDataUpdate}
                            renderInline={true}
                        />
                    )}
                </div>
            </div>

            <SaveCollectionModal
                isOpen={!!saveCurrentWindowTarget}
                onClose={() => setSaveCurrentWindowTarget(null)}
                folders={folders}
                addCollection={addCollection}
                addFolder={addFolder}
                onDataUpdate={onDataUpdate}
                onSaved={queueRevealBatch}
                snapshotCollection={saveCurrentWindowTarget}
            />

            <CurrentWindowCloseModal
                isOpen={!!closeCurrentWindowTarget}
                onClose={() => setCloseCurrentWindowTarget(null)}
                windowSnapshot={closeCurrentWindowTarget}
                folders={folders}
                addCollection={addCollection}
                onDataUpdate={onDataUpdate}
                onSaved={queueRevealBatch}
                onWindowClosed={handleCurrentWindowClosed}
            />

        </div>
    );
}

export default FPLayout;
