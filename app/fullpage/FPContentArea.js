import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import Select, { components } from 'react-select';
import {
    searchState,
    detailPanelOpenState,
    selectedCollectionUidState,
    selectedCurrentWindowIdState,
    selectedSessionEntryKeyState,
} from '../atoms/globalAppSettingsState';
import {
    collectionRevealBatchState,
    dragSessionState,
    draggingCollectionState,
    highlightedCollectionUidState,
} from '../atoms/animationsState';
import { sidebarNavigationState } from '../atoms/fullpageState';
import { noPermissionOpenState, shareFolderModalState, sharedActionConfirmState } from '../atoms/sharedFoldersState';
import { guardFolderEdit, isReadOnlySharedFolder } from '../utils/sharedFolderUtils';
import { isProState } from '../atoms/premiumState';
import { buildFolderMenuItems } from '../utils/folderMenuItems';
import ColorPicker from '../ColorPicker';
import {
    DndContext,
    DragOverlay,
    useDroppable,
} from '@dnd-kit/core';
import {
    SortableContext,
    rectSortingStrategy,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import FPCollectionCard from './FPCollectionCard';
import FPFavoritesSection from './FPFavoritesSection';
import FPCurrentWindowCard from './FPCurrentWindowCard';
import FPSessionCard from './FPSessionCard';
import FPSingleTabSessionRow from './FPSingleTabSessionRow';
import FPEmptyState from './FPEmptyState';
import FPBadge from './FPBadge';
import {
    updateFolderCollectionCount,
    loadAllCollections,
    batchDeleteCollections,
} from '../utils/storageUtils';
import { getColorValue, normalizeColorKey } from '../utils/colorMigration';
import { naturalCompare } from '../utils/naturalCompare';
import {
    MdArrowUpward,
    MdArrowDownward,
    MdAccessTime,
    MdViewList,
    MdOpenInNew,
    MdOpenInBrowser,
    MdEdit,
    MdPalette,
    MdClear,
    MdDelete,
    MdOutlineRefresh,
    MdContentCopy,
    MdCenterFocusWeak,
    MdExpandMore,
    MdExpandLess,
    MdSave,
    MdDoneAll,
    MdDriveFileMoveOutline,
    MdOutlineHome,
    MdSortByAlpha,
    MdCallSplit,
    MdPersonAdd,
    MdLinkOff,
    MdLogout,
} from 'react-icons/md';
import { FaPlay, FaStar, FaRegStar } from 'react-icons/fa';
import { useTaboxAIEnabled } from '../ai/useTaboxAIEnabled';
import { isAISupported } from '../ai/aiClient';
import { aiToolsModalOpenState, aiToolsScopeState, aiSplitTargetState } from '../atoms/aiState';
import { SPLIT_MIN_TABS } from '../utils/sharedConstants';
import AiBadge from '../AiBadge';
import { FaStop } from 'react-icons/fa6';
import { CiExport } from 'react-icons/ci';
import { PiGridNineFill } from 'react-icons/pi';
import { TbFileImport } from 'react-icons/tb';
import { browser } from '../../static/globals';
import { showSuccessToast, showErrorToast, showInfoToast } from '../toastHelpers';
import { useTrackedSync } from '../useTrackedSync';
import Modal from 'react-modal';
import './FPContentArea.css';
import useCollectionItemCrossDrag from '../useCollectionItemCrossDrag';
import { downloadTextFile } from '../utils';
import { buildCollectionUrlList, buildFolderUrlList, getCollectionUrls, copyToClipboard } from '../utils/index';
import {
    buildCollectionSubsetExport,
    openCollectionsInSequence,
} from '../utils/collectionBulkActions';
import {
    buildLegacyImportPayloadFromSelection,
    buildLegacyImportPreview,
} from '../utils/legacyImportPreview';
import {
    buildCollectionFromSnapshot,
    buildSnapshotFromSessionSelections,
} from '../utils/saveCollectionSnapshot';
import {
    buildGroupedAllCollectionSections,
    ROOT_LEVEL_SECTION_ID,
} from './fpCollectionSections';
import { filterCurrentWindowsBySearch, getMatchingCurrentWindows } from '../utils/currentWindows';
import {
    collectionDropKinds,
    collectionDropSides,
    normalizeCollectionParentId,
    sortCollectionsWithinParent,
} from '../utils/collectionSectionDragEngine';
import { useFPCollectionDnd } from './useFPCollectionDnd';
import { persistCollectionLayoutChanges } from '../utils/sharedCollectionSync';
import { getMatchingSessionWindows } from '../utils/searchUtils';
import { getBrowserSessionEntryKey, restoreBrowserSession } from '../utils/browserSessions';
import {
    duplicateFolder,
    deleteFolder,
    updateFolderDetails,
} from '../utils/folderOperations';
import FolderDeleteConfirmModal from '../FolderDeleteConfirmModal';
import CreateFolderModalBase from '../CreateFolderModal';
import { CURRENT_WINDOWS_ACCENT_COLOR } from './fpAccentColors';
import { getFavoriteCollections } from '../utils/favoritesUtils';

import AIButton from '../AIButton';

const SessionsModal = lazy(() => import('../SessionsModal').then(m => ({ default: m.SessionsModal })));
const SaveCollectionModal = lazy(() => import('./SaveCollectionModal'));
const BulkMoveCollectionsModal = lazy(() => import('./BulkMoveCollectionsModal'));
const BulkDeleteCollectionsModal = lazy(() => import('./BulkDeleteCollectionsModal'));

// Icons for the share/unshare/leave menu entries buildFolderMenuItems adds
// (kept icon-free so it stays unit-testable); rendered here alongside the
// hand-rolled fp-sidebar-ctx-item buttons.
const FOLDER_MENU_ICONS = {
    share: <MdPersonAdd size={16} />,
    unshare: <MdLinkOff size={16} />,
    'leave-shared': <MdLogout size={16} />,
    delete: <MdDelete size={16} />,
};

function SortOption(props) {
    const { icon: Icon } = props.data;

    return (
        <components.Option {...props}>
            <div className="toolbar-select-option">
                <Icon size={16} />
                <span>{props.label}</span>
            </div>
        </components.Option>
    );
}

function SortSingleValue(props) {
    const { icon: Icon } = props.data;

    return (
        <components.SingleValue {...props}>
            <div className="toolbar-select-single-value">
                <Icon size={16} />
                <span>{props.data.label}</span>
            </div>
        </components.SingleValue>
    );
}
const LegacyImportPreviewModal = lazy(() => import('./LegacyImportPreviewModal'));

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

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function getStartOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getSessionBucketLabel(timestamp, nowTimestamp = Date.now()) {
    const now = new Date(nowTimestamp);
    const elapsedMs = Math.max(0, nowTimestamp - timestamp);
    const elapsedHours = elapsedMs / (60 * 60 * 1000);
    const startOfToday = getStartOfLocalDay(now);
    const startOfSessionDay = getStartOfLocalDay(new Date(timestamp));
    const daysAgo = Math.floor((startOfToday - startOfSessionDay) / DAY_IN_MS);

    if (daysAgo <= 0) {
        if (elapsedHours <= 2) {
            return 'Last 2 hours';
        }

        if (elapsedHours <= 4) {
            return '2-4 hours ago';
        }

        if (elapsedHours <= 6) {
            return '4-6 hours ago';
        }

        return 'Earlier today';
    }

    if (daysAgo === 1) {
        return 'Yesterday';
    }

    if (daysAgo <= 3) {
        return 'Last 3 days';
    }

    if (daysAgo <= 7) {
        return 'Last 7 days';
    }

    if (daysAgo <= 30) {
        return 'Last 30 days';
    }

    if (daysAgo <= 90) {
        return 'Last 90 days';
    }

    return 'Older';
}

function flattenSessionEntries(sessionList) {
    return (sessionList || []).flatMap((session) => (
        (session.collections || []).map((collection) => ({
            collection,
            sessionTimestamp: session.timestamp,
            sessionEntryKey: getBrowserSessionEntryKey(collection, session.timestamp),
            sourceType: collection?.sourceType || session?.sourceType || 'window',
        }))
    ));
}

function groupSessionsByTimeRange(sessionEntries, nowTimestamp = Date.now()) {
    const buckets = [];
    const bucketsByLabel = new Map();

    (sessionEntries || []).forEach((entry) => {
        const label = getSessionBucketLabel(entry.sessionTimestamp, nowTimestamp);
        if (!bucketsByLabel.has(label)) {
            const bucket = {
                label,
                entries: [],
                itemCount: 0,
            };
            bucketsByLabel.set(label, bucket);
            buckets.push(bucket);
        }

        const bucket = bucketsByLabel.get(label);
        bucket.entries.push(entry);
        bucket.itemCount += 1;
    });

    return buckets;
}

const escapeSelectorValue = (value) => {
    if (typeof window !== 'undefined' && window.CSS?.escape) {
        return window.CSS.escape(value);
    }

    return String(value).replace(/"/g, '\\"');
};

const getCollectionShellElement = (collectionUid) => {
    if (typeof document === 'undefined' || !collectionUid) {
        return null;
    }

    return document.querySelector(`[data-sortable-collection-id="${escapeSelectorValue(collectionUid)}"]`);
};

const getSectionHeaderElement = (sectionId) => {
    if (typeof document === 'undefined' || !sectionId) {
        return null;
    }

    return document.querySelector(`[data-section-id="${escapeSelectorValue(sectionId)}"]`);
};

const getRevealScrollContainer = (fallbackContainer, targetElement) => (
    fallbackContainer ||
    targetElement?.closest('.fp-content-grid') ||
    targetElement?.closest('.fp-content-sessions') ||
    null
);

const scrollRevealTargetIntoView = ({
    container,
    target,
    reducedMotion,
    align = 'start',
}) => {
    if (!target) {
        return null;
    }

    if (!container) {
        target.scrollIntoView({
            behavior: reducedMotion ? 'auto' : 'smooth',
            block: align,
            inline: 'nearest',
        });
        return null;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const currentTop = container.scrollTop;
    const targetTop = currentTop + (targetRect.top - containerRect.top);
    let nextTop = targetTop;

    if (align === 'start') {
        nextTop = Math.max(0, targetTop - 18);
    } else if (align === 'center') {
        nextTop = Math.max(0, targetTop - ((container.clientHeight - targetRect.height) / 2));
    } else if (align === 'nearest') {
        const visibleTop = currentTop;
        const visibleBottom = currentTop + container.clientHeight;
        const targetBottom = targetTop + targetRect.height;

        if (targetTop < visibleTop) {
            nextTop = Math.max(0, targetTop - 18);
        } else if (targetBottom > visibleBottom) {
            nextTop = Math.max(0, targetBottom - container.clientHeight + 18);
        } else {
            nextTop = currentTop;
        }
    }

    if (typeof container.scrollTo === 'function') {
        container.scrollTo({
            top: nextTop,
            behavior: reducedMotion ? 'auto' : 'smooth',
        });
    } else {
        container.scrollTop = nextTop;
    }

    return nextTop;
};

const prefersReducedMotion = () => Boolean(
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
);

const waitForScrollSettled = ({
    container,
    targetTop,
    reducedMotion,
    isCancelled,
}) => {
    if (reducedMotion || !container || typeof window === 'undefined') {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let frameId = null;
        let timeoutId = null;
        let stableFrames = 0;
        let frameCount = 0;
        let lastTop = container.scrollTop;

        const finish = () => {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
            resolve();
        };

        const tick = () => {
            if (isCancelled()) {
                finish();
                return;
            }

            frameCount += 1;
            const currentTop = container.scrollTop;
            const frameDelta = Math.abs(currentTop - lastTop);
            const targetDelta = typeof targetTop === 'number' ? Math.abs(currentTop - targetTop) : frameDelta;

            if (targetDelta <= 2 || frameDelta <= 0.5) {
                stableFrames += 1;
            } else {
                stableFrames = 0;
            }

            lastTop = currentTop;

            if (stableFrames >= 6 || frameCount >= 120) {
                finish();
                return;
            }

            frameId = window.requestAnimationFrame(tick);
        };

        timeoutId = window.setTimeout(finish, 1800);
        frameId = window.requestAnimationFrame(tick);
    });
};

function FPSectionDropZone({
    className,
    children,
    parentId,
    dragType = collectionDropKinds.sectionStart,
    dropzoneIdPrefix = 'section-header',
    canHighlight = true,
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `${dropzoneIdPrefix}-${dragType}-${parentId ?? ROOT_LEVEL_SECTION_ID}`,
        data: {
            dragType,
            parentId,
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={`${className}${isOver && canHighlight ? ' is-over' : ''}`}
            data-grouped-section-parent-id={parentId}
        >
            {children}
        </div>
    );
}

function FPSectionEdgeDropZone({
    id,
    label,
    parentId,
    dragType = collectionDropKinds.sectionEnd,
    className = 'fp-grouped-section-edge-dropzone',
    canHighlight = true,
}) {
    const { setNodeRef, isOver } = useDroppable({
        id,
        data: {
            dragType,
            parentId,
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={`${className}${isOver && canHighlight ? ' is-over' : ''}`}
            data-grouped-section-edge-parent-id={parentId}
            aria-label={label}
        />
    );
}

function FPSectionContentDropZone({ id, className, children, parentId, canHighlight = true }) {
    const { setNodeRef, isOver } = useDroppable({
        id,
        data: {
            dragType: collectionDropKinds.sectionEmpty,
            parentId,
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={`${className}${isOver && canHighlight ? ' is-over' : ''}`}
            data-grouped-content-parent-id={parentId}
        >
            {children}
        </div>
    );
}

// Sortable card wrapper
function SortableFPCard({
    id,
    collection,
    disableDrag,
    activeId,
    suppressTransforms = false,
    hideWhileDragging = false,
    collapseWhileDragging = false,
    removeFromFlowWhileDragging = false,
    wrapperClassName = '',
    isRevealActive = false,
    revealIndex = -1,
    reducedMotionReveal = false,
    ...props
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id,
        disabled: disableDrag,
        data: {
            itemType: 'collection',
            dragType: 'collection-card',
            collection,
            collectionId: collection.uid,
            parentId: collection?.parentId || null,
        },
    });

    // Prevent rectSortingStrategy from applying scale transforms which cause size mismatches
    const adjustedTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;

    const hiddenWhileDraggingStyle = isDragging && hideWhileDragging
        ? (
            removeFromFlowWhileDragging
                ? {
                    opacity: 0,
                    visibility: 'hidden',
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    minWidth: 0,
                    minHeight: 0,
                    margin: 0,
                    padding: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                }
                : collapseWhileDragging
                ? {
                    opacity: 0,
                    visibility: 'hidden',
                    height: 0,
                    minHeight: 0,
                    margin: 0,
                    padding: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                }
                : {
                    opacity: 0,
                    visibility: 'hidden',
                    pointerEvents: 'none',
                }
        )
        : null;

    const style = {
        transform: suppressTransforms ? undefined : CSS.Transform.toString(adjustedTransform),
        transition: suppressTransforms ? 'none' : transition,
        opacity: isDragging && !hideWhileDragging ? 0.35 : undefined,
        ...(isRevealActive ? {
            '--fp-reveal-index': revealIndex,
            '--fp-reveal-color': normalizeColorKey(collection.color) !== 'default'
                ? getColorValue(collection.color)
                : 'var(--collection-default-color)',
        } : null),
        ...hiddenWhileDraggingStyle,
    };

    const shellClassName = [
        wrapperClassName,
        isRevealActive ? 'fp-collection-reveal-shell' : '',
        isRevealActive && reducedMotionReveal ? 'reduced-motion' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            ref={setNodeRef}
            style={style}
            data-sortable-collection-id={id}
            data-collection-reveal={isRevealActive ? 'true' : undefined}
            data-collection-reveal-index={isRevealActive ? revealIndex : undefined}
            className={shellClassName}
        >
            <FPCollectionCard
                {...props}
                activeId={activeId}
                collection={collection}
                dragAttributes={attributes}
                dragListeners={listeners}
                viewMode={props.viewMode}
            />
        </div>
    );
}

const MemoizedSortableFPCard = React.memo(SortableFPCard, (prev, next) => {
    return (
        prev.collection === next.collection &&
        prev.disableDrag === next.disableDrag &&
        prev.activeId === next.activeId &&
        prev.suppressTransforms === next.suppressTransforms &&
        prev.hideWhileDragging === next.hideWhileDragging &&
        prev.collapseWhileDragging === next.collapseWhileDragging &&
        prev.removeFromFlowWhileDragging === next.removeFromFlowWhileDragging &&
        prev.wrapperClassName === next.wrapperClassName &&
        prev.isRevealActive === next.isRevealActive &&
        prev.revealIndex === next.revealIndex &&
        prev.reducedMotionReveal === next.reducedMotionReveal &&
        prev.isAutoUpdate === next.isAutoUpdate &&
        prev.search === next.search &&
        prev.viewMode === next.viewMode &&
        prev.folderName === next.folderName &&
        prev.folderColor === next.folderColor &&
        prev.folders === next.folders &&
        prev.onSelect === next.onSelect &&
        prev.onCardContextMenu === next.onCardContextMenu &&
        prev.isInteractionActive === next.isInteractionActive &&
        prev.bulkSelectionActive === next.bulkSelectionActive &&
        prev.isBulkSelected === next.isBulkSelected &&
        prev.onToggleBulkSelected === next.onToggleBulkSelected &&
        prev.bulkSelectionAccentColor === next.bulkSelectionAccentColor
    );
});

function FPContentArea({
    collections = [],
    currentWindows = [],
    sessionList = [],
    folders = [],
    updateCollection,
    removeCollection,
    addCollection,
    addFolder,
    updateRemoteData,
    onFolderOptimisticUpdate,
    onDataUpdate,
    hasActiveFilters,
    triggerFolderLightningEffect,
    trackedCollectionUids,
    viewMode: initialViewMode,
    onViewModeChange,
    onFiltersChange,
    filters,
    onFolderStateChange,
    onSelectCurrentWindow,
    onFocusCurrentWindow,
    onSaveCurrentWindow,
    onCloseCurrentWindow,
    onSelectSession,
}) {
    const search = useAtomValue(searchState);
    const sidebarNavigation = useAtomValue(sidebarNavigationState);
    const collectionRevealBatch = useAtomValue(collectionRevealBatchState);
    const runTrackedSync = useTrackedSync();
    const highlightedCollectionUid = useAtomValue(highlightedCollectionUidState);
    const [disableDrag, setDisableDrag] = useState(false);
    const [showEntranceAnimation, setShowEntranceAnimation] = useState(true);
    const [activeSectionReveal, setActiveSectionReveal] = useState(null);
    const [activeCardReveal, setActiveCardReveal] = useState(null);
    const contentScrollRef = useRef(null);
    const revealTimersRef = useRef([]);
    const revealRunRef = useRef(null);
    const revealExpansionRef = useRef({ runId: null, folderIds: new Set() });

    // Detail panel state
    const setDetailPanelOpen = useSetAtom(detailPanelOpenState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const setSelectedCollectionUid = useSetAtom(selectedCollectionUidState);
    const setSelectedCurrentWindowId = useSetAtom(selectedCurrentWindowIdState);
    const setSelectedSessionEntryKey = useSetAtom(selectedSessionEntryKeyState);
    const setCollectionRevealBatch = useSetAtom(collectionRevealBatchState);
    const setNoPermissionOpen = useSetAtom(noPermissionOpenState);
    const setShareFolderModal = useSetAtom(shareFolderModalState);
    const setSharedActionConfirm = useSetAtom(sharedActionConfirmState);
    const isPro = useAtomValue(isProState);

    // AI: split-collection context-menu entry (mirrors the popup menu in
    // contextMenuItems.js — the full-page menu is hand-rolled, so it's wired here).
    const aiEnabled = useTaboxAIEnabled() && isAISupported();
    const setAIToolsOpen = useSetAtom(aiToolsModalOpenState);
    const setAIToolsScope = useSetAtom(aiToolsScopeState);
    const setSplitTarget = useSetAtom(aiSplitTargetState);
    const handleSplitCollection = useCallback((collection) => {
        setAIToolsScope({ type: 'selected', uids: [collection.uid] });
        setSplitTarget({ uid: collection.uid });
        setAIToolsOpen(true);
    }, [setAIToolsScope, setSplitTarget, setAIToolsOpen]);

    const dragSession = useAtomValue(dragSessionState);

    // Collection drag state for cross-context sidebar drops
    const setDraggingCollection = useSetAtom(draggingCollectionState);

    // Refs
    const collectionsRef = useRef(collections);
    const foldersRef = useRef(folders);
    useEffect(() => { collectionsRef.current = collections; }, [collections]);
    useEffect(() => { foldersRef.current = folders; }, [folders]);

    // Sort/view/filter state
    const [sortType, setSortType] = useState('DATE');
    const [sortAscending, setSortAscending] = useState(true);
    const [viewMode, setViewMode] = useState(initialViewMode || 'grid');
    const [openInNewWindow, setOpenInNewWindow] = useState(false);
    const [recentlyOpenedFilter, setRecentlyOpenedFilter] = useState(false);
    const [colorsFilter, setColorsFilter] = useState([]);
    const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
    const [isSaveAllWindowsModalOpen, setIsSaveAllWindowsModalOpen] = useState(false);
    const [folderModalOpen, setFolderModalOpen] = useState(false);
    const [editFolder, setEditFolder] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);
    const fileInputRef = useRef(null);
    const isMountedRef = useRef(true);

    const [selectedTabSessionEntryKeys, setSelectedTabSessionEntryKeys] = useState(() => new Set());
    const [selectedCollectionUids, setSelectedCollectionUids] = useState(() => new Set());
    const selectedCollectionUidsRef = useRef(selectedCollectionUids);
    const [saveCollectionRequest, setSaveCollectionRequest] = useState(null);
    const [isBulkMoveModalOpen, setIsBulkMoveModalOpen] = useState(false);
    const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
    const [legacyImportPreviewData, setLegacyImportPreviewData] = useState(null);
    const [parsedLegacyImportData, setParsedLegacyImportData] = useState(null);
    const [isImportingLegacyPreview, setIsImportingLegacyPreview] = useState(false);

    // Right-click context menu state
    const [cardCtxMenu, setCardCtxMenu] = useState(null);
    const [folderCtxMenu, setFolderCtxMenu] = useState(null);
    const cardCtxMenuRef = useRef(null);
    const folderCtxMenuRef = useRef(null);

    const updateSelectedCollectionUids = useCallback((updater) => {
        setSelectedCollectionUids((previous) => {
            const next = typeof updater === 'function' ? updater(previous) : updater;
            selectedCollectionUidsRef.current = next;
            return next;
        });
    }, []);

    const isSessionsView = sidebarNavigation === 'sessions';
    const isCurrentWindowsView = sidebarNavigation === 'current-windows';
    const isLightweightView = isSessionsView || isCurrentWindowsView;

    useEffect(() => {
        setRecentlyOpenedFilter(!!filters?.recentlyOpenedActual);
        setColorsFilter(filters?.colors ?? []);
    }, [filters?.recentlyOpenedActual, filters?.colors]);

    const queueRevealBatch = useCallback((collectionsToReveal) => {
        const payload = buildRevealBatchPayload(collectionsToReveal);
        if (payload) {
            setCollectionRevealBatch(payload);
        }
    }, [setCollectionRevealBatch]);

    const clearRevealTimers = useCallback(() => {
        revealTimersRef.current.forEach((timerId) => clearTimeout(timerId));
        revealTimersRef.current = [];
    }, []);

    // Load saved prefs
    useEffect(() => {
        const load = async () => {
            const { currentSortValue, currentSortAscending, fpViewMode, chkOpenNewWindow } = await browser.storage.local.get([
                'currentSortValue', 'currentSortAscending', 'fpViewMode', 'chkOpenNewWindow'
            ]);
            if (isMountedRef.current) {
                if (currentSortValue) setSortType(currentSortValue);
                if (currentSortAscending !== undefined) {
                    setSortAscending(typeof currentSortAscending === 'string' ? currentSortAscending === 'true' : currentSortAscending);
                }
                const mode = fpViewMode === 'list' ? 'list' : 'grid';
                setViewMode(mode);
                if (onViewModeChange) onViewModeChange(mode);
                setOpenInNewWindow(chkOpenNewWindow || false);
            }
        };
        load();
        return () => { isMountedRef.current = false; };
    }, []);

    // Command palette integration: listen for custom events to open modals/file picker
    useEffect(() => {
        const openFolder = () => setFolderModalOpen(true);
        const openImport = () => fileInputRef.current?.click();
        const openSession = () => { if (sessionList.length > 0) setIsSessionModalOpen(true); };
        window.addEventListener('tabox:open-create-folder', openFolder);
        window.addEventListener('tabox:open-import', openImport);
        window.addEventListener('tabox:open-restore-session', openSession);
        return () => {
            window.removeEventListener('tabox:open-create-folder', openFolder);
            window.removeEventListener('tabox:open-import', openImport);
            window.removeEventListener('tabox:open-restore-session', openSession);
        };
    }, [sessionList]);

    useEffect(() => {
        setDisableDrag(false);
    }, [search]);

    useEffect(() => {
        if (isSessionsView) {
            return;
        }

        setSelectedTabSessionEntryKeys((previous) => (previous.size > 0 ? new Set() : previous));
    }, [isSessionsView]);

    useEffect(() => {
        if (isLightweightView) {
            updateSelectedCollectionUids((previous) => (previous.size > 0 ? new Set() : previous));
        }
    }, [isLightweightView, updateSelectedCollectionUids]);

    useEffect(() => {
        setSelectedTabSessionEntryKeys((previous) => {
            if (previous.size === 0) {
                return previous;
            }

            const next = new Set([...previous].filter((entryKey) => visibleSingleTabEntryKeySet.has(entryKey)));
            return next.size === previous.size ? previous : next;
        });
    }, [visibleSingleTabEntryKeySet]);

    useEffect(() => {
        const timer = setTimeout(() => setShowEntranceAnimation(false), 450);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => () => {
        revealRunRef.current = null;
        clearRevealTimers();
    }, [clearRevealTimers]);

    // Find collection helper
    const findCollectionByUid = useCallback((uid) => {
        const cols = collectionsRef.current;
        const flds = foldersRef.current;
        const rootCol = cols.find(c => c.uid === uid);
        if (rootCol) return { collection: rootCol, folder: null };
        for (const folder of flds) {
            if (folder.collections) {
                const fc = folder.collections.find(c => c.uid === uid);
                if (fc) return { collection: fc, folder };
            }
        }
        return { collection: null, folder: null };
    }, []);

    useCollectionItemCrossDrag({
        findCollectionByUid,
        updateCollection,
        onDataUpdate,
    });

    const sortFieldMap = useMemo(() => ({ 'DATE': 'lastUpdated', 'NAME': 'name', 'COLOR': 'color' }), []);

    // Flat sort comparator used for the "all" view so folder grouping doesn't interfere
    const flatSortCollections = useCallback((list) => {
        const allHaveOrder = list.every(c => c.order !== undefined && c.order !== null);
        if (allHaveOrder) return list;

        const field = sortFieldMap[sortType] || 'lastUpdated';
        return [...list].sort((a, b) => {
            const aVal = a[field];
            const bVal = b[field];
            if (field === 'name' || field === 'color') {
                return sortAscending ? naturalCompare(aVal, bVal) : naturalCompare(bVal, aVal);
            }
            const aNum = aVal || 0;
            const bNum = bVal || 0;
            return sortAscending ? aNum - bNum : bNum - aNum;
        });
    }, [sortType, sortAscending, sortFieldMap]);

    // Optimistic reorder: holds the locally-reordered array until the real
    // collections prop catches up from updateRemoteData.
    const [optimisticCollections, setOptimisticCollections] = useState(null);
    useEffect(() => { setOptimisticCollections(null); }, [collections]);

    const sourceCollections = optimisticCollections || collections;
    const hasSearchQuery = !!search?.trim();
    const disableCollectionDragAndDrop = disableDrag || hasSelectedCollections || hasSearchQuery;
    const viewModeToggleTooltip = hasSearchQuery
        ? 'View mode is unavailable while search is active'
        : viewMode === 'grid'
            ? 'Switch to list'
            : 'Switch to grid';
    const sortByField = sortFieldMap[sortType] || 'lastUpdated';
    const sortOrder = sortAscending ? 'asc' : 'desc';
    const shouldRenderGroupedAllCollections = sidebarNavigation === 'all' && !hasActiveFilters && !hasSearchQuery;
    const isFavoritesView = sidebarNavigation === 'favorites';
    const isMixedParentFlatView = !shouldRenderGroupedAllCollections && (
        hasSearchQuery ||
        hasActiveFilters
    );
    const canReorderFlatCollections = !isMixedParentFlatView && (
        sidebarNavigation === 'unorganized' ||
        (
            sidebarNavigation !== 'all' &&
            sidebarNavigation !== 'sessions' &&
            sidebarNavigation !== 'favorites'
        )
    );

    // Sidebar filtering
    const filteredCollections = useMemo(() => {
        const currentFolderUidSet = new Set(folders.map((folder) => folder.uid));

        switch (sidebarNavigation) {
            case 'all': return shouldRenderGroupedAllCollections ? sourceCollections : flatSortCollections(sourceCollections);
            case 'unorganized': {
                return sortCollectionsWithinParent({
                    collections: sourceCollections,
                    folderUidSet: currentFolderUidSet,
                    parentId: null,
                    sortBy: sortByField,
                    sortOrder,
                });
            }
            case 'favorites':
                return getFavoriteCollections(sourceCollections);
            case 'current-windows':
            case 'sessions':
                return [];
            default: // folder UID
                return sortCollectionsWithinParent({
                    collections: sourceCollections,
                    folderUidSet: currentFolderUidSet,
                    parentId: sidebarNavigation,
                    sortBy: sortByField,
                    sortOrder,
                });
        }
    }, [sourceCollections, sidebarNavigation, folders, flatSortCollections, shouldRenderGroupedAllCollections, sortByField, sortOrder]);

    const filteredCurrentWindows = useMemo(() => (
        filterCurrentWindowsBySearch(currentWindows, search)
    ), [currentWindows, search]);

    const matchingCurrentWindows = useMemo(() => (
        getMatchingCurrentWindows(currentWindows, search)
    ), [currentWindows, search]);

    const flattenedSessionEntries = useMemo(
        () => flattenSessionEntries(sessionList),
        [sessionList],
    );

    const matchingSessionEntries = useMemo(() => (
        getMatchingSessionWindows(sessionList, search)
    ), [sessionList, search]);

    const groupedSessionBuckets = useMemo(
        () => groupSessionsByTimeRange(flattenedSessionEntries),
        [flattenedSessionEntries],
    );

    const visibleSingleTabSessionEntries = useMemo(() => {
        if (search?.trim()) {
            return matchingSessionEntries.filter((entry) => entry.collection?.sourceType === 'tab');
        }

        return groupedSessionBuckets.flatMap((bucket) => (
            bucket.entries.filter((entry) => entry.sourceType === 'tab')
        ));
    }, [groupedSessionBuckets, matchingSessionEntries, search]);

    const visibleSingleTabEntryKeySet = useMemo(
        () => new Set(visibleSingleTabSessionEntries.map((entry) => entry.sessionEntryKey)),
        [visibleSingleTabSessionEntries],
    );

    const selectedVisibleTabSessionEntries = useMemo(
        () => visibleSingleTabSessionEntries.filter((entry) => selectedTabSessionEntryKeys.has(entry.sessionEntryKey)),
        [selectedTabSessionEntryKeys, visibleSingleTabSessionEntries],
    );

    const hasSelectedTabSessions = selectedVisibleTabSessionEntries.length > 0;
    const allVisibleTabSessionsSelected = visibleSingleTabSessionEntries.length > 0 &&
        selectedVisibleTabSessionEntries.length === visibleSingleTabSessionEntries.length;

    // Folder name map for cards
    const folderNameMap = useMemo(() => {
        const map = {};
        folders.forEach(f => { map[f.uid] = f.name; });
        return map;
    }, [folders]);

    const folderColorMap = useMemo(() => {
        const map = {};
        folders.forEach(f => {
            map[f.uid] = f.color && f.color !== 'default'
                ? getColorValue(f.color)
                : 'var(--primary-color)';
        });
        return map;
    }, [folders]);

    const folderUidSet = useMemo(() => new Set(folders.map(folder => folder.uid)), [folders]);

    const folderByUid = useMemo(() => {
        const map = new Map();
        folders.forEach((folder) => map.set(folder.uid, folder));
        return map;
    }, [folders]);

    // Guard a bulk write against every folder it touches (source folders of the
    // affected collections, plus a move's target folder). Mirrors guardFolderEdit
    // but fans out over a set of folder ids - opens the no-permission modal and
    // returns false as soon as any touched folder is read-only shared.
    const guardBulkFolderEdit = useCallback((folderIds) => {
        const uniqueFolderIds = [...new Set([...folderIds].filter(Boolean))];
        return uniqueFolderIds.every((folderId) => (
            guardFolderEdit(folderByUid.get(folderId), () => setNoPermissionOpen(true))
        ));
    }, [folderByUid, setNoPermissionOpen]);

    const activeFolder = useMemo(
        () => folders.find((folder) => folder.uid === sidebarNavigation) || null,
        [folders, sidebarNavigation],
    );

    const contentHeading = useMemo(() => {
        const collectionCountLabel = `${filteredCollections.length} collection${filteredCollections.length !== 1 ? 's' : ''}`;
        const currentWindowCountLabel = `${filteredCurrentWindows.length} window${filteredCurrentWindows.length !== 1 ? 's' : ''}`;
        const sessionCount = search?.trim() ? matchingSessionEntries.length : flattenedSessionEntries.length;
        const sessionCountLabel = `${sessionCount} item${sessionCount !== 1 ? 's' : ''}`;
        const searchSubtitle = search ? `Matches for "${search}"` : null;

        if (activeFolder) {
            return {
                badge: search ? 'Folder search' : 'Folder',
                title: activeFolder.name,
                subtitle: searchSubtitle || 'Collections saved in this folder',
                countLabel: collectionCountLabel,
                accentColor: folderColorMap[activeFolder.uid],
            };
        }

        if (search) {
            if (isCurrentWindowsView) {
                return {
                    badge: 'Search results',
                    title: 'Current Windows',
                    subtitle: searchSubtitle,
                    countLabel: currentWindowCountLabel,
                    accentColor: CURRENT_WINDOWS_ACCENT_COLOR,
                };
            }
            if (isSessionsView) {
                return {
                    badge: 'Search results',
                    title: 'Recently Closed',
                    subtitle: searchSubtitle,
                    countLabel: sessionCountLabel,
                    accentColor: '#F59E0B',
                };
            }

            const searchTitles = {
                all: 'All Collections',
                unorganized: 'No Folder',
            };

            return {
                badge: 'Search results',
                title: searchTitles[sidebarNavigation] || 'Collections',
                subtitle: searchSubtitle,
                countLabel: collectionCountLabel,
                accentColor: 'var(--primary-color)',
            };
        }

        switch (sidebarNavigation) {
            case 'all':
                return {
                    badge: 'Library area',
                    title: 'All Collections',
                    subtitle: 'Everything you have saved in Tabox',
                    countLabel: collectionCountLabel,
                    accentColor: 'var(--primary-color)',
                };
            case 'favorites':
                return {
                    badge: 'Library area',
                    title: 'Favorites',
                    subtitle: 'Collections you starred',
                    countLabel: collectionCountLabel,
                    accentColor: 'var(--favorite-star-color)',
                };
            case 'unorganized':
                return {
                    badge: 'Library area',
                    title: 'No Folder',
                    subtitle: 'Collections still sitting at the root level',
                    countLabel: collectionCountLabel,
                    accentColor: 'var(--primary-color)',
                };
            case 'current-windows':
                return {
                    badge: 'Live view',
                    title: 'Current Windows',
                    subtitle: 'Open browser windows available right now',
                    countLabel: currentWindowCountLabel,
                    accentColor: CURRENT_WINDOWS_ACCENT_COLOR,
                };
            case 'sessions':
                return {
                    badge: 'History',
                    title: 'Recently Closed',
                    subtitle: 'Recently closed tabs and windows from this browser',
                    countLabel: sessionCountLabel,
                    accentColor: '#F59E0B',
                };
            default:
                return {
                    badge: 'Collections',
                    title: 'Collections',
                    subtitle: 'Saved collections in this section',
                    countLabel: collectionCountLabel,
                    accentColor: 'var(--primary-color)',
                };
        }
    }, [
        activeFolder,
        filteredCollections.length,
        filteredCurrentWindows.length,
        flattenedSessionEntries.length,
        folderColorMap,
        isCurrentWindowsView,
        isSessionsView,
        matchingSessionEntries.length,
        search,
        sidebarNavigation,
    ]);

    const displayCollections = filteredCollections;

    const groupedSections = useMemo(() => {
        if (!shouldRenderGroupedAllCollections) {
            return [];
        }

        return buildGroupedAllCollectionSections({
            collections: displayCollections,
            folders,
            sortBy: sortByField,
            sortOrder,
        });
    }, [displayCollections, folders, shouldRenderGroupedAllCollections, sortByField, sortOrder]);

    const groupedSectionCollectionsMap = useMemo(() => {
        const map = new Map();
        groupedSections.forEach((section) => {
            map.set(section.kind === 'root' ? null : section.id, section.collections || []);
        });
        return map;
    }, [groupedSections]);

    const visibleCollections = useMemo(() => {
        if (isLightweightView) {
            return [];
        }

        if (!shouldRenderGroupedAllCollections) {
            return displayCollections;
        }

        return groupedSections.flatMap((section) => (
            section.kind === 'root' || !section.collapsed
                ? (section.collections || [])
                : []
        ));
    }, [displayCollections, groupedSections, isLightweightView, shouldRenderGroupedAllCollections]);

    const visibleCollectionUidSet = useMemo(
        () => new Set(visibleCollections.map((collection) => collection.uid)),
        [visibleCollections],
    );

    const selectedVisibleCollections = useMemo(
        () => visibleCollections.filter((collection) => selectedCollectionUids.has(collection.uid)),
        [selectedCollectionUids, visibleCollections],
    );

    const hasSelectedCollections = selectedVisibleCollections.length > 0;
    const allVisibleCollectionsSelected = visibleCollections.length > 0 &&
        selectedVisibleCollections.length === visibleCollections.length;
    const hasSelectedCollectionsInFolders = selectedVisibleCollections.some((collection) => !!collection.parentId);
    const bulkSelectionColor = useMemo(() => {
        if (selectedVisibleCollections.length === 0) {
            return null;
        }

        const firstColor = selectedVisibleCollections[0].color || 'default';
        return selectedVisibleCollections.every((collection) => (collection.color || 'default') === firstColor)
            ? firstColor
            : null;
    }, [selectedVisibleCollections]);

    useEffect(() => {
        updateSelectedCollectionUids((previous) => {
            if (previous.size === 0) {
                return previous;
            }

            const next = new Set([...previous].filter((uid) => visibleCollectionUidSet.has(uid)));
            return next.size === previous.size ? previous : next;
        });
    }, [updateSelectedCollectionUids, visibleCollectionUidSet]);

    useEffect(() => {
        if (!hasSelectedCollections) {
            setIsBulkMoveModalOpen(false);
            setIsBulkDeleteModalOpen(false);
            return;
        }

        setCardCtxMenu(null);
        setFolderCtxMenu(null);
    }, [hasSelectedCollections]);

    const activeCardRevealMap = useMemo(() => {
        const map = new Map();
        (activeCardReveal?.items || []).forEach((item, index) => {
            map.set(item.uid, {
                index,
                reducedMotion: activeCardReveal?.reducedMotion === true,
            });
        });
        return map;
    }, [activeCardReveal]);

    useEffect(() => {
        if (!collectionRevealBatch?.items?.length) {
            revealExpansionRef.current = { runId: null, folderIds: new Set() };
            return;
        }

        if (isLightweightView) {
            revealRunRef.current = null;
            clearRevealTimers();
            setActiveSectionReveal(null);
            setActiveCardReveal(null);
            setCollectionRevealBatch(null);
            revealExpansionRef.current = { runId: null, folderIds: new Set() };
            return;
        }

        revealRunRef.current = collectionRevealBatch.runId;
        clearRevealTimers();
        setActiveSectionReveal(null);
        setActiveCardReveal(null);

        const knownCollectionUids = new Set(sourceCollections.map((collection) => collection.uid));
        const knownRevealItems = collectionRevealBatch.items
            .filter((item) => knownCollectionUids.has(item.uid))
            .map((item) => ({
                uid: item.uid,
                parentId: item.parentId && folderUidSet.has(item.parentId) ? item.parentId : null,
            }));

        if (knownRevealItems.length === 0) {
            return;
        }

        if (shouldRenderGroupedAllCollections && onFolderStateChange) {
            const requestedExpansion = revealExpansionRef.current.runId === collectionRevealBatch.runId
                ? revealExpansionRef.current.folderIds
                : new Set();
            const foldersToExpand = folders.filter((folder) => (
                folder.collapsed &&
                knownRevealItems.some((item) => item.parentId === folder.uid) &&
                !requestedExpansion.has(folder.uid)
            ));

            if (foldersToExpand.length > 0) {
                foldersToExpand.forEach((folder) => {
                    requestedExpansion.add(folder.uid);
                    onFolderStateChange({
                        ...folder,
                        collapsed: false,
                    });
                });
                revealExpansionRef.current = {
                    runId: collectionRevealBatch.runId,
                    folderIds: requestedExpansion,
                };
                return;
            }
        }

        const visibleCollectionUids = new Set(displayCollections.map((collection) => collection.uid));
        const visibleRevealItems = knownRevealItems.filter((item) => visibleCollectionUids.has(item.uid));

        if (visibleRevealItems.length === 0) {
            revealRunRef.current = null;
            clearRevealTimers();
            setActiveSectionReveal(null);
            setActiveCardReveal(null);
            setCollectionRevealBatch(null);
            revealExpansionRef.current = { runId: null, folderIds: new Set() };
            return;
        }

        let targetSectionId = null;
        let scrollTargetElement = null;

        if (shouldRenderGroupedAllCollections) {
            if (visibleRevealItems.some((item) => item.parentId === null)) {
                targetSectionId = ROOT_LEVEL_SECTION_ID;
            } else {
                const firstImpactedSection = groupedSections.find((section) => (
                    section.kind !== 'root' &&
                    visibleRevealItems.some((item) => item.parentId === section.id)
                ));
                targetSectionId = firstImpactedSection?.id || null;
            }

            const headerElement = targetSectionId ? getSectionHeaderElement(targetSectionId) : null;
            const firstSectionItem = visibleRevealItems.find((item) => (
                targetSectionId === ROOT_LEVEL_SECTION_ID
                    ? item.parentId === null
                    : item.parentId === targetSectionId
            ));
            scrollTargetElement = headerElement || getCollectionShellElement(firstSectionItem?.uid);
        } else {
            scrollTargetElement = getCollectionShellElement(visibleRevealItems[0]?.uid);
        }

        if (!scrollTargetElement) {
            return;
        }

        const revealRunId = collectionRevealBatch.runId;
        const isCancelled = () => (
            revealRunRef.current !== revealRunId ||
            !isMountedRef.current
        );
        const reducedMotion = prefersReducedMotion();
        const scrollContainer = getRevealScrollContainer(contentScrollRef.current, scrollTargetElement);
        const scrollTargetTop = scrollRevealTargetIntoView({
            container: scrollContainer,
            target: scrollTargetElement,
            reducedMotion,
            align: targetSectionId ? 'start' : 'nearest',
        });
        const revealDelay = reducedMotion ? 0 : 120;
        const sectionDuration = reducedMotion ? 1500 : 900;
        const cardDuration = reducedMotion ? 1500 : 1500 + (visibleRevealItems.length * 90);

        setCollectionRevealBatch(null);
        revealExpansionRef.current = { runId: null, folderIds: new Set() };

        void waitForScrollSettled({
            container: scrollContainer,
            targetTop: scrollTargetTop,
            reducedMotion,
            isCancelled,
        }).then(() => {
            if (isCancelled()) {
                return;
            }

            setActiveSectionReveal(targetSectionId ? {
                runId: revealRunId,
                sectionId: targetSectionId,
                reducedMotion,
            } : null);

            revealTimersRef.current.push(setTimeout(() => {
                if (isCancelled()) {
                    return;
                }

                setActiveCardReveal({
                    runId: revealRunId,
                    items: visibleRevealItems,
                    reducedMotion,
                });
            }, revealDelay));

            if (targetSectionId) {
                revealTimersRef.current.push(setTimeout(() => {
                    if (isCancelled()) {
                        return;
                    }

                    setActiveSectionReveal((currentValue) => (
                        currentValue?.runId === revealRunId ? null : currentValue
                    ));
                }, sectionDuration));
            }

            revealTimersRef.current.push(setTimeout(() => {
                if (isCancelled()) {
                    return;
                }

                setActiveCardReveal((currentValue) => (
                    currentValue?.runId === revealRunId ? null : currentValue
                ));

                if (revealRunRef.current === revealRunId) {
                    revealRunRef.current = null;
                }
            }, revealDelay + cardDuration));
        });
    }, [
        clearRevealTimers,
        collectionRevealBatch,
        displayCollections,
        folderUidSet,
        folders,
        groupedSections,
        isLightweightView,
        onFolderStateChange,
        setCollectionRevealBatch,
        shouldRenderGroupedAllCollections,
        sourceCollections,
    ]);

    useEffect(() => {
        if (!highlightedCollectionUid || isLightweightView) {
            return;
        }

        const highlightedCollection = sourceCollections.find((collection) => collection.uid === highlightedCollectionUid);
        if (!highlightedCollection) {
            return;
        }

        const normalizedParentId = highlightedCollection.parentId && folderUidSet.has(highlightedCollection.parentId)
            ? highlightedCollection.parentId
            : null;
        const visibleCollectionUids = new Set(displayCollections.map((collection) => collection.uid));
        if (!visibleCollectionUids.has(highlightedCollectionUid)) {
            return;
        }

        if (shouldRenderGroupedAllCollections && normalizedParentId) {
            const parentFolder = folders.find((folder) => folder.uid === normalizedParentId);
            if (parentFolder?.collapsed && onFolderStateChange) {
                onFolderStateChange({
                    ...parentFolder,
                    collapsed: false,
                });
                return;
            }
        }

        const targetSectionId = shouldRenderGroupedAllCollections
            ? normalizedParentId || ROOT_LEVEL_SECTION_ID
            : null;

        const revealRunId = `highlight-${highlightedCollectionUid}-${Date.now()}`;
        const revealItems = [{ uid: highlightedCollectionUid, parentId: normalizedParentId }];
        const reducedMotion = prefersReducedMotion();
        revealRunRef.current = revealRunId;
        clearRevealTimers();
        setActiveSectionReveal(null);
        setActiveCardReveal(null);

        const isCancelled = () => (
            revealRunRef.current !== revealRunId ||
            !isMountedRef.current
        );
        const revealDelay = reducedMotion ? 0 : 120;
        const sectionDuration = reducedMotion ? 1500 : 900;
        const cardDuration = reducedMotion ? 1500 : 1500;

        Promise.resolve().then(() => {
            if (isCancelled()) {
                return;
            }

            setActiveSectionReveal(targetSectionId ? {
                runId: revealRunId,
                sectionId: targetSectionId,
                reducedMotion,
            } : null);

            revealTimersRef.current.push(setTimeout(() => {
                if (isCancelled()) {
                    return;
                }

                setActiveCardReveal({
                    runId: revealRunId,
                    items: revealItems,
                    reducedMotion,
                });
            }, revealDelay));

            if (targetSectionId) {
                revealTimersRef.current.push(setTimeout(() => {
                    if (isCancelled()) {
                        return;
                    }

                    setActiveSectionReveal((currentValue) => (
                        currentValue?.runId === revealRunId ? null : currentValue
                    ));
                }, sectionDuration));
            }

            revealTimersRef.current.push(setTimeout(() => {
                if (isCancelled()) {
                    return;
                }

                setActiveCardReveal((currentValue) => (
                    currentValue?.runId === revealRunId ? null : currentValue
                ));

                if (revealRunRef.current === revealRunId) {
                    revealRunRef.current = null;
                }
            }, revealDelay + cardDuration));
        });
    }, [
        clearRevealTimers,
        displayCollections,
        folderUidSet,
        folders,
        highlightedCollectionUid,
        isLightweightView,
        onFolderStateChange,
        setHighlightedCollectionUid,
        shouldRenderGroupedAllCollections,
        sourceCollections,
    ]);

    const collectionIndexMap = useMemo(() => {
        const map = new Map();
        displayCollections.forEach((collection, index) => {
            map.set(collection.uid, index);
        });
        return map;
    }, [displayCollections]);

    // Panel handlers
    const handleSelectCollection = useCallback((collection) => {
        setDetailPanelOpen(true);
        setSelectedCurrentWindowId(null);
        setSelectedSessionEntryKey(null);
        setSelectedCollectionUid(collection?.uid || null);
    }, [setDetailPanelOpen, setSelectedCollectionUid, setSelectedCurrentWindowId, setSelectedSessionEntryKey]);

    // Right-click context menu handlers
    const handleCardContextMenu = useCallback((e, collection, isAutoUpdate, operations) => {
        e.preventDefault();
        e.stopPropagation();

        const menuWidth = 220;
        const menuHeight = 280;
        const pad = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = e.clientX;
        let y = e.clientY - 4;
        if (x + menuWidth + pad > vw) x = vw - menuWidth - pad;
        if (y + menuHeight + pad > vh) y = vh - menuHeight - pad;
        if (x < pad) x = pad;
        if (y < pad) y = pad;

        setCardCtxMenu({ collection, isAutoUpdate, operations, x, y });
    }, []);

    const closeCardCtxMenu = useCallback(() => setCardCtxMenu(null), []);

    useEffect(() => {
        if (!cardCtxMenu) return;
        const close = () => setCardCtxMenu(null);
        const handleClick = (e) => {
            if (cardCtxMenuRef.current && !cardCtxMenuRef.current.contains(e.target)) close();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('scroll', close, true);
        };
    }, [cardCtxMenu]);

    useEffect(() => {
        if (!folderCtxMenu) return;
        const close = () => setFolderCtxMenu(null);
        const handleClick = (e) => {
            if (folderCtxMenuRef.current && !folderCtxMenuRef.current.contains(e.target)) close();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('scroll', close, true);
        };
    }, [folderCtxMenu]);

    const handleCtxMenuAction = useCallback((action) => {
        if (action && typeof action === 'function') action();
        closeCardCtxMenu();
    }, [closeCardCtxMenu]);

    const handleCopyCollectionUrls = useCallback(async (collection) => {
        try {
            const urlList = buildCollectionUrlList(collection);
            if (!urlList) { showInfoToast('No URLs to copy'); return; }
            await copyToClipboard(urlList);
            const count = urlList.split('\n').length;
            showSuccessToast(`${count} URL${count === 1 ? '' : 's'} copied`);
        } catch {
            showErrorToast('Failed to copy URLs');
        }
    }, []);

    const handleFolderContextMenu = useCallback((e, folder) => {
        e.preventDefault();
        e.stopPropagation();

        const menuWidth = 210;
        const menuHeight = 230;
        const pad = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = e.clientX;
        let y = e.clientY - 4;
        if (x + menuWidth + pad > vw) x = vw - menuWidth - pad;
        if (y + menuHeight + pad > vh) y = vh - menuHeight - pad;
        if (x < pad) x = pad;
        if (y < pad) y = pad;

        setFolderCtxMenu({ folder, x, y });
    }, []);

    const closeFolderCtxMenu = useCallback(() => setFolderCtxMenu(null), []);

    const handleFolderEdit = useCallback((folderUid, name, color) => {
        const folder = folders.find((f) => f.uid === folderUid);
        if (!folder) return;

        const hasChanges = name !== folder.name || color !== folder.color;
        if (!hasChanges) return;

        const previousFolderDetails = {
            name: folder.name,
            color: folder.color,
        };

        onFolderOptimisticUpdate?.(folderUid, { name, color });

        void (async () => {
            const updated = await updateFolderDetails(folderUid, { name, color });

            if (!updated) {
                onFolderOptimisticUpdate?.(folderUid, previousFolderDetails);
                showErrorToast('Failed to update folder');
                return;
            }

            showSuccessToast('Folder updated');
        })();
    }, [folders, onFolderOptimisticUpdate]);

    const handleFolderCtxEdit = useCallback(() => {
        if (!folderCtxMenu) return;
        setEditFolder(folderCtxMenu.folder);
        closeFolderCtxMenu();
    }, [folderCtxMenu, closeFolderCtxMenu]);

    const handleFolderCtxExport = useCallback(async () => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        try {
            const allCollections = await loadAllCollections();
            const collectionsInFolder = allCollections.filter((collection) => collection.parentId === folder.uid);
            const exportData = {
                type: 'folder',
                folder: {
                    uid: folder.uid,
                    name: folder.name,
                    color: folder.color,
                    collapsed: folder.collapsed,
                    createdAt: folder.createdAt,
                    lastUpdated: folder.lastUpdated,
                    collectionCount: collectionsInFolder.length,
                },
                collections: collectionsInFolder,
                exportedAt: new Date().toISOString(),
                version: '2.0',
            };
            downloadTextFile(JSON.stringify(exportData, null, 2), `${folder.name || 'folder'}_export`);
            showSuccessToast('Folder exported');
        } catch {
            showErrorToast('Export failed');
        }
    }, [folderCtxMenu, closeFolderCtxMenu]);

    const handleFolderCtxOpenAll = useCallback(async () => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        try {
            const { getFolderCollections } = await import('../utils/folderOperations');
            const collectionsToOpen = await getFolderCollections(folder.uid);

            if (collectionsToOpen.length === 0) {
                showErrorToast('No collections in this folder');
                return;
            }

            const { openedCount, failedCollections } = await openCollectionsInSequence(collectionsToOpen);

            if (onDataUpdate) {
                await onDataUpdate();
            }

            if (openedCount > 0) {
                showSuccessToast(`Opened ${openedCount} collection(s)`);
            }

            if (failedCollections.length > 0) {
                showErrorToast(`Failed to open: ${failedCollections.join(', ')}`);
            }
        } catch {
            showErrorToast('Failed to open collections');
        }
    }, [folderCtxMenu, closeFolderCtxMenu, onDataUpdate]);

    const handleFolderCtxDuplicate = useCallback(async () => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        try {
            const result = await duplicateFolder(folder.uid);
            if (result.success) {
                showSuccessToast(`Duplicated "${folder.name}" with ${result.duplicatedCollections} collection(s)`);
                if (onDataUpdate) await onDataUpdate();
            } else {
                showErrorToast('Failed to duplicate folder');
            }
        } catch {
            showErrorToast('Failed to duplicate folder');
        }
    }, [folderCtxMenu, closeFolderCtxMenu, onDataUpdate]);

    const handleFolderCtxCopyUrls = useCallback(async () => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        try {
            const { getFolderCollections } = await import('../utils/folderOperations');
            const collections = await getFolderCollections(folder.uid);
            const totalUrls = collections.reduce((n, c) => n + getCollectionUrls(c).length, 0);
            if (totalUrls === 0) { showInfoToast('No URLs to copy'); return; }
            await copyToClipboard(buildFolderUrlList(folder, collections));
            showSuccessToast(`${totalUrls} URL${totalUrls === 1 ? '' : 's'} copied`);
        } catch {
            showErrorToast('Failed to copy URLs');
        }
    }, [folderCtxMenu, closeFolderCtxMenu]);

    const handleFolderCtxShare = useCallback(() => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        setShareFolderModal(folder);
    }, [folderCtxMenu, closeFolderCtxMenu, setShareFolderModal]);

    // Leave/Unshare confirmation hardening: opens the shared
    // SharedActionConfirmModal (rendered once by App.js) instead of firing
    // the sendMessage+toast+refresh directly on a single click — that logic
    // now lives in app/utils/sharedFolderActions.js, called by the modal's
    // Confirm button.
    const handleFolderCtxLeave = useCallback(() => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        setSharedActionConfirm({ kind: 'leave', folder });
    }, [folderCtxMenu, closeFolderCtxMenu, setSharedActionConfirm]);

    const handleFolderCtxUnshare = useCallback(() => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        setSharedActionConfirm({ kind: 'unshare', folder });
    }, [folderCtxMenu, closeFolderCtxMenu, setSharedActionConfirm]);

    const handleFolderCtxDelete = useCallback(async () => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        const collectionCount = groupedSectionCollectionsMap.get(folder.uid)?.length || 0;
        if (collectionCount > 0) {
            setDeleteModal({ folder, collectionCount });
            return;
        }

        const result = await deleteFolder(folder.uid, true, false, { skipSync: true });
        if (result.success) {
            showSuccessToast('Folder deleted');
            if (onDataUpdate) await onDataUpdate();
            await runTrackedSync();
        } else if (result.blocked) {
            setNoPermissionOpen(true);
        } else {
            showErrorToast('Failed to delete folder');
        }
    }, [folderCtxMenu, closeFolderCtxMenu, groupedSectionCollectionsMap, onDataUpdate, runTrackedSync, setNoPermissionOpen]);

    const handleDeleteConfirm = useCallback(async (deleteCollections) => {
        if (!deleteModal) return;
        const { folder } = deleteModal;
        setDeleteModal(null);
        const result = await deleteFolder(folder.uid, true, deleteCollections, { skipSync: true });
        if (result.success) {
            const msg = deleteCollections
                ? `Folder and ${result.collectionsDeleted} collection(s) deleted`
                : `Folder deleted (${result.collectionsMovedToRoot} collection(s) moved to root)`;
            showSuccessToast(msg);
            if (onDataUpdate) await onDataUpdate();
            await runTrackedSync();
        } else if (result.blocked) {
            setNoPermissionOpen(true);
        } else {
            showErrorToast('Failed to delete folder');
        }
    }, [deleteModal, onDataUpdate, runTrackedSync, setNoPermissionOpen]);

    const persistCollectionChanges = useCallback(async (nextCollections, affectedParentIds = []) => {
        await persistCollectionLayoutChanges({
            nextCollections,
            affectedParentIds,
            folderUidSet,
            updateRemoteData,
            setOptimisticCollections,
        });
    }, [folderUidSet, updateRemoteData]);

    const handleToggleFolderSection = useCallback((folder) => {
        const nextCollapsed = !folder.collapsed;
        if (onFolderStateChange) {
            onFolderStateChange({
                ...folder,
                collapsed: nextCollapsed,
            });
        }
    }, [onFolderStateChange]);

    const {
        sensors,
        measuring,
        customCollisionDetection,
        activeCollection,
        previewTarget,
        activeDragRectRef,
        handleDragStart,
        handleDragMove,
        handleDragOver,
        handleDragEnd,
        resetDragState,
    } = useFPCollectionDnd({
        sourceCollections,
        displayCollections,
        folders,
        folderUidSet,
        viewMode,
        sortByField,
        sortOrder,
        dragSession,
        hasSearchQuery,
        shouldRenderGroupedAllCollections,
        canReorderFlatCollections,
        groupedSectionCollectionsMap,
        persistCollectionChanges,
        setHighlightedCollectionUid,
        setDraggingCollection,
        triggerFolderLightningEffect,
    });

    const activeParentId = useMemo(() => (
        activeCollection ? normalizeCollectionParentId(activeCollection, folderUidSet) : null
    ), [activeCollection, folderUidSet]);

    // Sort handler — uses flatSort so all collections sort globally regardless of folder.
    // Read-only shared collections are excluded from the write: their manual order was
    // set by the folder's owner, not this (read-only) member, so a global sort must not
    // touch it.
    const handleSort = async (sortBy, ascending) => {
        const { loadAllCollections, batchUpdateCollections } = await import('../utils/storageUtils');
        const sortFieldMap = { 'DATE': 'lastUpdated', 'NAME': 'name', 'COLOR': 'color' };
        const sortByField = sortFieldMap[sortBy] || 'lastUpdated';
        const sortOrder = ascending ? 'asc' : 'desc';
        const readOnlyFolderUids = new Set(folders.filter(isReadOnlySharedFolder).map((folder) => folder.uid));
        const isReadOnlyShared = (collection) => Boolean(collection.parentId) && readOnlyFolderUids.has(collection.parentId);
        const allCols = await loadAllCollections({ metadataOnly: false, sortBy: sortByField, sortOrder, flatSort: true });
        const cleared = allCols
            .filter((c) => !isReadOnlyShared(c))
            .map(c => ({ ...c, order: null }));
        await batchUpdateCollections(cleared);
        const reloaded = await loadAllCollections({ metadataOnly: false, sortBy: sortByField, sortOrder, flatSort: true });
        const cleaned = reloaded.map((c) => {
            if (isReadOnlyShared(c)) return c;
            const copy = { ...c };
            delete copy.order;
            return copy;
        });
        await updateRemoteData(cleaned);
        await browser.storage.local.set({ currentSortValue: sortBy, currentSortAscending: ascending });
    };

    const handleSortTypeChange = async (newType) => {
        setSortType(newType);
        await handleSort(newType, sortAscending);
    };

    const toggleSortDirection = async () => {
        const newDir = !sortAscending;
        setSortAscending(newDir);
        await handleSort(sortType, newDir);
    };

    const toggleViewMode = async () => {
        if (hasSearchQuery) {
            return;
        }

        const newMode = viewMode === 'list' ? 'grid' : 'list';
        setViewMode(newMode);
        await browser.storage.local.set({ fpViewMode: newMode });
        if (onViewModeChange) onViewModeChange(newMode);
    };

    const toggleNewWindow = async () => {
        const newValue = !openInNewWindow;
        setOpenInNewWindow(newValue);
        await browser.storage.local.set({ chkOpenNewWindow: newValue });
    };

    const emitFiltersChange = useCallback((nextFilters) => {
        if (!onFiltersChange) {
            return;
        }

        onFiltersChange({
            recentlyOpenedActual: nextFilters.recentlyOpenedActual,
            colors: nextFilters.colors,
        });
    }, [onFiltersChange]);

    const toggleRecentlyOpenedFilter = () => {
        const newVal = !recentlyOpenedFilter;
        setRecentlyOpenedFilter(newVal);
        emitFiltersChange({
            recentlyOpenedActual: newVal,
            colors: colorsFilter,
        });
    };

    const handleColorFilterChange = (color) => {
        const newColors = colorsFilter.includes(color)
            ? colorsFilter.filter((c) => c !== color)
            : [...colorsFilter, color];
        setColorsFilter(newColors);
        emitFiltersChange({
            recentlyOpenedActual: recentlyOpenedFilter,
            colors: newColors,
        });
    };

    const handleColorFilterClear = () => {
        setColorsFilter([]);
        emitFiltersChange({
            recentlyOpenedActual: recentlyOpenedFilter,
            colors: [],
        });
    };

    const clearAllFilters = () => {
        setRecentlyOpenedFilter(false);
        setColorsFilter([]);
        emitFiltersChange({ recentlyOpenedActual: false, colors: [] });
    };

    const hasLocalActiveFilters = recentlyOpenedFilter || colorsFilter.length > 0;

    // Import
    const handleFileSelection = async (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const normalizedFileName = (file.name || '').toLowerCase();
        if (!normalizedFileName.endsWith('.txt')) {
            showErrorToast('Invalid file: Please select a .txt file');
            event.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = async function () {
            const trimmed = reader.result.trim();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                showErrorToast('Invalid file format');
                event.target.value = '';
                return;
            }
            try {
                const parsed = JSON.parse(trimmed);
                event.target.value = '';
                const previewData = buildLegacyImportPreview(parsed);
                setParsedLegacyImportData(parsed);
                setLegacyImportPreviewData(previewData);
            } catch (err) {
                showErrorToast('Invalid JSON: ' + err.message);
                event.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    const handleConfirmLegacyImport = useCallback(async ({ selectedCollectionIds }) => {
        if (!parsedLegacyImportData || !legacyImportPreviewData) {
            return;
        }

        setIsImportingLegacyPreview(true);
        try {
            const filteredImportData = buildLegacyImportPayloadFromSelection({
                parsedImportData: parsedLegacyImportData,
                selectedCollectionIds,
                allPreviewCollections: legacyImportPreviewData.collections,
            });
            const importResult = await browser.runtime.sendMessage({
                type: 'importData',
                data: filteredImportData,
            });

            if (importResult && importResult.success) {
                if (onDataUpdate) {
                    await onDataUpdate();
                }
                if (importResult.importedCollections?.length) {
                    queueRevealBatch(importResult.importedCollections);
                }
                setLegacyImportPreviewData(null);
                setParsedLegacyImportData(null);
                showSuccessToast(importResult.message);
            } else {
                showErrorToast('Import failed: ' + (importResult?.error || 'Unknown error'));
            }
        } catch (error) {
            showErrorToast('Import failed: ' + (error?.message || 'Unknown error'));
        } finally {
            setIsImportingLegacyPreview(false);
        }
    }, [legacyImportPreviewData, onDataUpdate, parsedLegacyImportData, queueRevealBatch]);

    const handleFolderSave = async (name, color) => {
        if (addFolder) await addFolder(name, color);
    };

    const handleSaveSessionAsCollection = (collection) => {
        setSaveCollectionRequest({ sessionCollection: collection });
    };

    const clearSelectedCollections = useCallback(() => {
        updateSelectedCollectionUids((previous) => (previous.size > 0 ? new Set() : previous));
    }, [updateSelectedCollectionUids]);

    const handleToggleCollectionSelection = useCallback((collection) => {
        const collectionUid = collection?.uid;
        if (!collectionUid || isLightweightView) {
            return;
        }

        updateSelectedCollectionUids((previous) => {
            const next = new Set(previous);
            if (next.has(collectionUid)) {
                next.delete(collectionUid);
            } else {
                next.add(collectionUid);
            }
            return next;
        });
    }, [isLightweightView, updateSelectedCollectionUids]);

    const handleToggleSelectAllCollections = useCallback(() => {
        if (visibleCollections.length === 0) {
            return;
        }

        updateSelectedCollectionUids((previous) => {
            if (previous.size === visibleCollections.length &&
                visibleCollections.every((collection) => previous.has(collection.uid))) {
                return new Set();
            }

            return new Set(visibleCollections.map((collection) => collection.uid));
        });
    }, [updateSelectedCollectionUids, visibleCollections]);

    const loadSelectedCollectionSnapshot = useCallback(async () => {
        const selectedIdSet = new Set(
            [...selectedCollectionUidsRef.current].filter((uid) => visibleCollectionUidSet.has(uid))
        );
        const selectedIds = visibleCollections
            .filter((collection) => selectedIdSet.has(collection.uid))
            .map((collection) => collection.uid);
        if (selectedIds.length === 0) {
            return {
                selectedIds: [],
                selectedIdSet: new Set(),
                allCollections: [],
                selectedCollections: [],
            };
        }

        const selectedOrder = new Map(selectedIds.map((uid, index) => [uid, index]));
        const allCollections = await loadAllCollections({
            metadataOnly: false,
            sortBy: sortByField,
            sortOrder,
            flatSort: true,
        });
        const selectedCollections = allCollections
            .filter((collection) => selectedIdSet.has(collection.uid))
            .sort((a, b) => selectedOrder.get(a.uid) - selectedOrder.get(b.uid));

        return {
            selectedIds,
            selectedIdSet,
            allCollections,
            selectedCollections,
        };
    }, [sortByField, sortOrder, visibleCollectionUidSet, visibleCollections]);

    const handleBulkOpenSelectedCollections = useCallback(async () => {
        const { selectedCollections } = await loadSelectedCollectionSnapshot();
        if (selectedCollections.length === 0) {
            return;
        }

        const { openedCount, failedCollections } = await openCollectionsInSequence(selectedCollections);

        if (onDataUpdate) {
            await onDataUpdate();
        }

        if (openedCount > 0) {
            showSuccessToast(`Opened ${openedCount} collection${openedCount !== 1 ? 's' : ''}`);
        }

        if (failedCollections.length > 0) {
            showErrorToast(`Failed to open: ${failedCollections.join(', ')}`);
        }
    }, [loadSelectedCollectionSnapshot, onDataUpdate]);

    const handleBulkExportSelectedCollections = useCallback(async () => {
        const { selectedCollections } = await loadSelectedCollectionSnapshot();
        if (selectedCollections.length === 0) {
            return;
        }

        const exportData = buildCollectionSubsetExport({
            collections: selectedCollections,
            folders,
        });

        downloadTextFile(
            JSON.stringify(exportData, null, 2),
            `tabox-collections-export-${Date.now()}`,
        );
        showSuccessToast(`Exported ${selectedCollections.length} collection${selectedCollections.length !== 1 ? 's' : ''}`);
    }, [folders, loadSelectedCollectionSnapshot]);

    const handleBulkRecolorCollections = useCallback(async (newColor) => {
        const { selectedIdSet, allCollections, selectedCollections } = await loadSelectedCollectionSnapshot();
        if (selectedCollections.length === 0) {
            return;
        }

        const normalizedColor = newColor || 'default';
        const recoloredCollections = selectedCollections.filter(
            (collection) => (collection.color || 'default') !== normalizedColor,
        );

        if (recoloredCollections.length === 0) {
            return;
        }

        const affectedFolderIds = recoloredCollections.map((collection) => collection.parentId);
        if (!guardBulkFolderEdit(affectedFolderIds)) {
            return;
        }

        const nextCollections = allCollections.map((collection) => (
            selectedIdSet.has(collection.uid)
                ? {
                    ...collection,
                    color: normalizedColor,
                    lastUpdated: Date.now(),
                }
                : collection
        ));

        await updateRemoteData(nextCollections);
        if (onDataUpdate) {
            await onDataUpdate();
        }

        showSuccessToast(`Updated color for ${recoloredCollections.length} collection${recoloredCollections.length !== 1 ? 's' : ''}`);
    }, [guardBulkFolderEdit, loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

    const handleOpenBulkMoveModal = useCallback(() => {
        if (!hasSelectedCollections || folders.length === 0) {
            return;
        }

        setIsBulkMoveModalOpen(true);
    }, [folders.length, hasSelectedCollections]);

    const handleConfirmBulkMoveCollections = useCallback(async (targetFolderId) => {
        if (!targetFolderId) {
            return;
        }

        const { selectedIdSet, allCollections, selectedCollections } = await loadSelectedCollectionSnapshot();
        if (selectedCollections.length === 0) {
            setIsBulkMoveModalOpen(false);
            return;
        }

        const movedCollections = selectedCollections.filter((collection) => collection.parentId !== targetFolderId);
        if (movedCollections.length === 0) {
            setIsBulkMoveModalOpen(false);
            return;
        }

        const touchedFolderIds = [targetFolderId, ...movedCollections.map((collection) => collection.parentId)];
        if (!guardBulkFolderEdit(touchedFolderIds)) {
            setIsBulkMoveModalOpen(false);
            return;
        }

        const nextCollections = allCollections.map((collection) => (
            selectedIdSet.has(collection.uid) && collection.parentId !== targetFolderId
                ? {
                    ...collection,
                    parentId: targetFolderId,
                    lastUpdated: Date.now(),
                }
                : collection
        ));

        const affectedFolderIds = new Set([
            targetFolderId,
            ...movedCollections.map((collection) => collection.parentId).filter(Boolean),
        ]);

        await updateRemoteData(nextCollections);
        await Promise.all([...affectedFolderIds].map((folderId) => updateFolderCollectionCount(folderId)));
        if (onDataUpdate) {
            await onDataUpdate();
        }

        setIsBulkMoveModalOpen(false);
        const targetFolderName = folders.find((folder) => folder.uid === targetFolderId)?.name || 'folder';
        showSuccessToast(`Moved ${movedCollections.length} collection${movedCollections.length !== 1 ? 's' : ''} to ${targetFolderName}`);
    }, [folders, guardBulkFolderEdit, loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

    const handleBulkRemoveFromFolder = useCallback(async () => {
        const { selectedIdSet, allCollections, selectedCollections } = await loadSelectedCollectionSnapshot();
        const removableCollections = selectedCollections.filter((collection) => !!collection.parentId);
        if (removableCollections.length === 0) {
            return;
        }

        const affectedFolderIds = removableCollections.map((collection) => collection.parentId);
        if (!guardBulkFolderEdit(affectedFolderIds)) {
            return;
        }

        const nextCollections = allCollections.map((collection) => (
            selectedIdSet.has(collection.uid) && collection.parentId
                ? {
                    ...collection,
                    parentId: null,
                    lastUpdated: Date.now(),
                }
                : collection
        ));

        await updateRemoteData(nextCollections);
        await Promise.all([...new Set(affectedFolderIds.filter(Boolean))].map((folderId) => updateFolderCollectionCount(folderId)));
        if (onDataUpdate) {
            await onDataUpdate();
        }

        showSuccessToast(`Removed ${removableCollections.length} collection${removableCollections.length !== 1 ? 's' : ''} from folder${removableCollections.length !== 1 ? 's' : ''}`);
    }, [guardBulkFolderEdit, loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

    const handleOpenBulkDeleteModal = useCallback(() => {
        if (!hasSelectedCollections) {
            return;
        }

        setIsBulkDeleteModalOpen(true);
    }, [hasSelectedCollections]);

    const handleConfirmBulkDeleteCollections = useCallback(async () => {
        const { selectedIds, selectedIdSet, allCollections, selectedCollections } = await loadSelectedCollectionSnapshot();
        if (selectedCollections.length === 0) {
            setIsBulkDeleteModalOpen(false);
            return;
        }

        const affectedFolderIds = selectedCollections.map((collection) => collection.parentId);
        if (!guardBulkFolderEdit(affectedFolderIds)) {
            setIsBulkDeleteModalOpen(false);
            return;
        }

        const success = await batchDeleteCollections(selectedIds);
        if (!success) {
            showErrorToast('Failed to delete collections');
            return;
        }

        const remainingCollections = allCollections.filter((collection) => !selectedIdSet.has(collection.uid));

        await updateRemoteData(remainingCollections);
        await Promise.all([...new Set(affectedFolderIds.filter(Boolean))].map((folderId) => updateFolderCollectionCount(folderId)));

        clearSelectedCollections();
        setIsBulkDeleteModalOpen(false);
        if (onDataUpdate) {
            await onDataUpdate();
        }

        showSuccessToast(`Deleted ${selectedCollections.length} collection${selectedCollections.length !== 1 ? 's' : ''}`);
    }, [batchDeleteCollections, clearSelectedCollections, guardBulkFolderEdit, loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

    const clearSelectedTabSessions = useCallback(() => {
        setSelectedTabSessionEntryKeys((previous) => (previous.size > 0 ? new Set() : previous));
    }, []);

    const handleToggleTabSessionSelection = useCallback((collection, sessionTimestamp) => {
        const sessionEntryKey = getBrowserSessionEntryKey(collection, sessionTimestamp);
        if (!sessionEntryKey) {
            return;
        }

        setSelectedTabSessionEntryKeys((previous) => {
            const next = new Set(previous);
            if (next.has(sessionEntryKey)) {
                next.delete(sessionEntryKey);
            } else {
                next.add(sessionEntryKey);
            }
            return next;
        });
    }, []);

    const handleToggleSelectAllTabSessions = useCallback(() => {
        if (visibleSingleTabSessionEntries.length === 0) {
            return;
        }

        setSelectedTabSessionEntryKeys((previous) => {
            if (previous.size === visibleSingleTabSessionEntries.length &&
                visibleSingleTabSessionEntries.every((entry) => previous.has(entry.sessionEntryKey))) {
                return new Set();
            }

            return new Set(visibleSingleTabSessionEntries.map((entry) => entry.sessionEntryKey));
        });
    }, [visibleSingleTabSessionEntries]);

    const buildSelectedTabSessionSnapshot = useCallback(() => (
        buildSnapshotFromSessionSelections({
            snapshots: selectedVisibleTabSessionEntries.map((entry) => entry.collection),
        })
    ), [selectedVisibleTabSessionEntries]);

    const handleBulkSaveSelectedTabs = useCallback(() => {
        if (!hasSelectedTabSessions) {
            return;
        }

        setSaveCollectionRequest({
            snapshotCollection: buildSelectedTabSessionSnapshot(),
            clearSelectedTabsOnSaved: true,
        });
    }, [buildSelectedTabSessionSnapshot, hasSelectedTabSessions]);

    const handleBulkExportSelectedTabs = useCallback(() => {
        if (!hasSelectedTabSessions) {
            return;
        }

        const selectedSnapshot = buildSelectedTabSessionSnapshot();
        const exportCollection = buildCollectionFromSnapshot({
            snapshot: selectedSnapshot,
            name: selectedSnapshot.name,
        });

        downloadTextFile(JSON.stringify(exportCollection, null, 2), exportCollection.name);
        showSuccessToast(`Exported ${selectedVisibleTabSessionEntries.length} tab${selectedVisibleTabSessionEntries.length !== 1 ? 's' : ''}`);
    }, [buildSelectedTabSessionSnapshot, hasSelectedTabSessions, selectedVisibleTabSessionEntries.length]);

    const handleBulkRestoreSelectedTabs = useCallback(async () => {
        if (!hasSelectedTabSessions) {
            return;
        }

        const selectedEntriesSnapshot = [...selectedVisibleTabSessionEntries];
        const results = await Promise.allSettled(
            selectedEntriesSnapshot.map((entry) => restoreBrowserSession(entry.collection))
        );
        const restoredCount = results.filter((result) => result.status === 'fulfilled').length;
        const failedCount = results.length - restoredCount;

        if (restoredCount > 0) {
            showSuccessToast(`Restored ${restoredCount} tab${restoredCount !== 1 ? 's' : ''}`);
        }

        if (failedCount > 0) {
            showErrorToast(`Failed to restore ${failedCount} tab${failedCount !== 1 ? 's' : ''}`);
        }
    }, [hasSelectedTabSessions, selectedVisibleTabSessionEntries]);

    // Empty state helpers
    const emptyStateTheme = typeof document !== 'undefined'
        ? document.documentElement.getAttribute('data-theme')
        : 'light';
    const emptyStatePlaceholderImage = emptyStateTheme === 'dark'
        ? 'images/desert-night.png'
        : 'images/desert.png';

    const getEmptyState = () => {
        if (search) {
            if (isCurrentWindowsView) {
                return { icon: '🪟', title: 'No results', description: `No windows match "${search}"` };
            }
            if (isSessionsView) {
                return { icon: '🕐', title: 'No results', description: `No recently closed items match "${search}"` };
            }
            return { icon: '🔍', title: 'No results', description: `No collections match "${search}"` };
        }
        switch (sidebarNavigation) {
            case 'unorganized':
                return {
                    icon: '📦',
                    title: 'All organized',
                    description: 'Every collection belongs to a folder',
                    imageSrc: emptyStatePlaceholderImage,
                    imageAlt: 'Desert scene',
                };
            case 'current-windows':
                return { icon: '🪟', title: 'No open windows', description: 'Open browser windows will appear here in real time' };
            case 'sessions':
                return { icon: '🕐', title: 'Nothing recently closed', description: 'Recently closed browser items will appear here' };
            default:
                if (sidebarNavigation !== 'all') {
                    return { icon: '📁', title: 'Empty folder', description: 'Drag collections here or save new tabs' };
                }
                return {
                    icon: '📋',
                    title: 'No collections yet',
                    description: 'Save your open tabs to get started',
                    imageSrc: emptyStatePlaceholderImage,
                    imageAlt: 'Desert scene',
                    actions: [{ label: 'Save Current Tabs', onClick: () => setSaveCollectionRequest({}) }]
                };
        }
    };

    const renderEmptyState = () => (
        <div className="fp-content-empty-state-wrap">
            <FPEmptyState {...getEmptyState()} />
        </div>
    );

    const sortOptions = [
        { value: 'DATE', label: 'Date', icon: MdAccessTime },
        { value: 'NAME', label: 'Name', icon: MdSortByAlpha },
        { value: 'COLOR', label: 'Color', icon: MdPalette },
    ];
    const menuPortalTarget = typeof document !== 'undefined' ? document.body : null;

    const renderSessionEntry = ({ sessionTimestamp, collection, matchingTabs = null, sessionEntryKey = null, sourceType = null }) => {
        const entrySourceType = sourceType || collection?.sourceType || 'window';

        if (entrySourceType === 'tab') {
            return (
                <FPSingleTabSessionRow
                    key={sessionEntryKey || `${sessionTimestamp}::${collection.uid}`}
                    collection={collection}
                    sessionTimestamp={sessionTimestamp}
                    search={search}
                    isSelected={selectedTabSessionEntryKeys.has(sessionEntryKey || getBrowserSessionEntryKey(collection, sessionTimestamp))}
                    selectionEnabled={hasSelectedTabSessions}
                    onToggleSelected={handleToggleTabSessionSelection}
                    onSaveAsCollection={handleSaveSessionAsCollection}
                />
            );
        }

        return (
            <FPSessionCard
                key={sessionEntryKey || `${sessionTimestamp}::${collection.uid}`}
                collection={collection}
                sessionTimestamp={sessionTimestamp}
                onSelect={onSelectSession}
                onSaveAsCollection={handleSaveSessionAsCollection}
                search={search}
                matchingTabs={matchingTabs}
            />
        );
    };

    const renderDefaultCollectionToolbarControls = () => (
        <>
            {visibleCollections.length > 0 && (
                <>
                    <div className="fp-toolbar-group fp-toolbar-group-selection">
                        <button
                            type="button"
                            className="fp-toolbar-btn"
                            onClick={handleToggleSelectAllCollections}
                            aria-label="Select All"
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content="Select all visible collections"
                        >
                            <MdDoneAll size={16} />
                        </button>
                    </div>

                    <div className="fp-toolbar-divider" />
                </>
            )}

            <div className={`fp-toolbar-leading ${hasLocalActiveFilters ? 'is-visible' : ''}`}>
                <button
                    className="fp-toolbar-clear"
                    onClick={clearAllFilters}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Clear all filters"
                    tabIndex={hasLocalActiveFilters ? 0 : -1}
                    aria-hidden={!hasLocalActiveFilters}
                >
                    <MdClear size={16} />
                </button>
                <div className="fp-toolbar-divider fp-toolbar-leading-divider" />
            </div>

            <div className="fp-toolbar-group">
                <button
                    className={`fp-toolbar-pill ${recentlyOpenedFilter ? 'active' : ''}`}
                    onClick={toggleRecentlyOpenedFilter}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Show recently opened (last 3 hours)"
                >
                    <MdOpenInBrowser size={18} />
                    <span>Opened</span>
                </button>
                <div className="fp-toolbar-color-picker"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Filter by color"
                >
                    <MdPalette size={18} className="fp-toolbar-color-icon" />
                    <ColorPicker
                        multiSelect
                        selectedColors={colorsFilter}
                        action={handleColorFilterChange}
                        onClear={handleColorFilterClear}
                        tooltip="Filter by color"
                        size="small"
                    />
                </div>
            </div>

            <div className="fp-toolbar-divider" />

            <div className="fp-toolbar-group">
                <div id="fp-toolbar-sort-select" className="toolbar-select-shell">
                    <Select
                        className="toolbar-select"
                        classNamePrefix="toolbar-select"
                        value={sortOptions.find((option) => option.value === sortType)}
                        onChange={(selectedOption) => handleSortTypeChange(selectedOption.value)}
                        options={sortOptions}
                        isSearchable={false}
                        isClearable={false}
                        components={{
                            Option: SortOption,
                            SingleValue: SortSingleValue,
                        }}
                        aria-label="Sort collections"
                        menuPortalTarget={menuPortalTarget}
                        menuPosition="fixed"
                        styles={{
                            menuPortal: (base) => ({
                                ...base,
                                zIndex: 1000001,
                            }),
                        }}
                    />
                </div>
                <button
                    className="fp-toolbar-btn"
                    onClick={toggleSortDirection}
                    aria-label={sortAscending ? 'Ascending' : 'Descending'}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={sortAscending ? 'Ascending' : 'Descending'}
                >
                    {sortAscending ? <MdArrowDownward size={20} /> : <MdArrowUpward size={20} />}
                </button>
            </div>

            <div className="fp-toolbar-divider" />

            <div className="fp-toolbar-group">
                <button
                    className={`fp-toolbar-btn ${openInNewWindow ? 'active' : ''}`}
                    onClick={toggleNewWindow}
                    aria-label={openInNewWindow ? 'Open in new window' : 'Open in current window'}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={openInNewWindow ? 'Open in new window' : 'Open in current window'}
                >
                    <MdOpenInNew size={20} />
                </button>
                <button
                    className="fp-toolbar-btn"
                    onClick={toggleViewMode}
                    aria-label={viewModeToggleTooltip}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={viewModeToggleTooltip}
                    disabled={hasSearchQuery}
                >
                    {viewMode === 'grid' ? <MdViewList size={20} /> : <PiGridNineFill size={20} />}
                </button>
                <button
                    className="fp-toolbar-btn"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Import collections from file"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Import collections from file"
                >
                    <TbFileImport size={18} />
                </button>
            </div>

            <AIButton withDivider selectedUids={selectedVisibleCollections.map((c) => c.uid)} />
        </>
    );

    const renderSelectedCollectionToolbarControls = () => {
        if (hasSelectedCollections === false) {
            return null;
        }

        return (
            <div className="fp-toolbar-group fp-toolbar-group-selection fp-toolbar-group-collection-selection">
                <button
                    type="button"
                    className={`fp-toolbar-btn ${allVisibleCollectionsSelected ? 'active' : ''}`}
                    onClick={handleToggleSelectAllCollections}
                    aria-label={allVisibleCollectionsSelected ? 'Unselect All' : 'Select All'}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={allVisibleCollectionsSelected ? 'Unselect all visible collections' : 'Select all visible collections'}
                >
                    <MdDoneAll size={16} />
                </button>

                <FPBadge accent="info" className="fp-toolbar-session-selection-pill fp-toolbar-collection-selection-pill">
                    <span className="fp-toolbar-session-selection-count">
                        {selectedVisibleCollections.length} selected
                    </span>
                </FPBadge>

                <button
                    type="button"
                    className="fp-toolbar-btn fp-toolbar-primary-btn"
                    onClick={handleBulkOpenSelectedCollections}
                    aria-label="Open Selected"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Open selected collections"
                >
                    <MdOpenInBrowser size={20} />
                </button>
                <button
                    type="button"
                    className="fp-toolbar-btn"
                    onClick={handleOpenBulkMoveModal}
                    disabled={folders.length === 0}
                    aria-label="Move to Folder"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={folders.length === 0 ? 'Create a folder before moving collections' : 'Move selected collections to a folder'}
                >
                    <MdDriveFileMoveOutline size={20} />
                </button>
                <button
                    type="button"
                    className="fp-toolbar-btn"
                    onClick={handleBulkRemoveFromFolder}
                    disabled={!hasSelectedCollectionsInFolders}
                    aria-label="Remove from Folder"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={hasSelectedCollectionsInFolders ? 'Move selected collections to the root level' : 'Selected collections are already at the root level'}
                >
                    <MdOutlineHome size={20} />
                </button>
                <div
                    className="fp-toolbar-color-picker fp-toolbar-bulk-color-picker"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Recolor selected collections"
                >
                    <MdPalette size={18} className="fp-toolbar-color-icon" />
                    <ColorPicker
                        currentColor={bulkSelectionColor}
                        action={handleBulkRecolorCollections}
                        tooltip="Recolor selected collections"
                        size="small"
                    />
                </div>
                <button
                    type="button"
                    className="fp-toolbar-btn"
                    onClick={handleBulkExportSelectedCollections}
                    aria-label="Export"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Export selected collections"
                >
                    <CiExport size={16} />
                </button>
                <button
                    type="button"
                    className="fp-toolbar-btn fp-toolbar-danger-btn"
                    onClick={handleOpenBulkDeleteModal}
                    aria-label="Delete"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Delete selected collections"
                >
                    <MdDelete size={16} />
                </button>
                <button
                    type="button"
                    className="fp-toolbar-btn fp-toolbar-session-clear-btn"
                    onClick={clearSelectedCollections}
                    aria-label="Clear"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Clear selected collections"
                >
                    <MdClear size={16} />
                </button>
            </div>
        );
    };

    const renderSelectedTabToolbarControls = () => {
        if (!isSessionsView || (visibleSingleTabSessionEntries.length === 0 && !hasSelectedTabSessions)) {
            return null;
        }

        return (
            <>
                <div className="fp-toolbar-group fp-toolbar-group-selection">
                    {visibleSingleTabSessionEntries.length > 0 && (
                        <button
                            type="button"
                            className={`fp-toolbar-btn ${allVisibleTabSessionsSelected ? 'active' : ''}`}
                            onClick={handleToggleSelectAllTabSessions}
                            aria-label={allVisibleTabSessionsSelected ? 'Unselect All' : 'Select All'}
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content={allVisibleTabSessionsSelected ? 'Unselect all visible single tabs' : 'Select all visible single tabs'}
                        >
                            <MdDoneAll size={16} />
                        </button>
                    )}

                    {hasSelectedTabSessions && (
                        <>
                            <FPBadge accent="session" className="fp-toolbar-session-selection-pill">
                                <span className="fp-toolbar-session-selection-count">
                                    {selectedVisibleTabSessionEntries.length} selected
                                </span>
                                <span className="fp-toolbar-session-selection-label">
                                    Single tabs
                                </span>
                            </FPBadge>

                            <button
                                type="button"
                                className="fp-toolbar-btn fp-toolbar-primary-btn"
                                onClick={handleBulkRestoreSelectedTabs}
                                aria-label="Restore"
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Restore selected tabs"
                            >
                                <MdOpenInNew size={16} />
                            </button>
                            <button
                                type="button"
                                className="fp-toolbar-btn"
                                onClick={handleBulkSaveSelectedTabs}
                                aria-label="Save as Collection"
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Save selected tabs as a collection"
                            >
                                <MdSave size={16} />
                            </button>
                            <button
                                type="button"
                                className="fp-toolbar-btn"
                                onClick={handleBulkExportSelectedTabs}
                                aria-label="Export to File"
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Export selected tabs to file"
                            >
                                <CiExport size={16} />
                            </button>
                            <button
                                type="button"
                                className="fp-toolbar-btn fp-toolbar-session-clear-btn"
                                onClick={clearSelectedTabSessions}
                                aria-label="Clear"
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Clear selected tabs"
                            >
                                <MdClear size={16} />
                            </button>
                        </>
                    )}
                </div>

                <div className="fp-toolbar-divider" />
            </>
        );
    };

    // Render session groups
    const renderSessionsContent = () => {
        const sessionSearchLayoutClassName = [
            'fp-session-group-cards',
            'fp-content-list-mode',
            search?.trim() ? 'fp-content-search-mode' : '',
        ].filter(Boolean).join(' ');

        if (search?.trim()) {
            if (matchingSessionEntries.length === 0) {
                return renderEmptyState();
            }

            return (
                <div className={sessionSearchLayoutClassName}>
                    {matchingSessionEntries.map(({ sessionTimestamp, collection, matchingTabs }) => (
                        renderSessionEntry({
                            sessionTimestamp,
                            collection,
                            matchingTabs,
                            sessionEntryKey: getBrowserSessionEntryKey(collection, sessionTimestamp),
                            sourceType: collection?.sourceType,
                        })
                    ))}
                </div>
            );
        }

        if (flattenedSessionEntries.length === 0) {
            return renderEmptyState();
        }
        return groupedSessionBuckets.map((bucket) => {
            return (
                <React.Fragment key={bucket.label}>
                    <div className="fp-session-group-header">
                        <span className="fp-session-group-label">{bucket.label}</span>
                        <span className="fp-session-group-meta">
                            {bucket.itemCount} item{bucket.itemCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <div className={sessionSearchLayoutClassName}>
                        {bucket.entries.map((entry) => renderSessionEntry(entry))}
                    </div>
                </React.Fragment>
            );
        });
    };

    const renderCurrentWindowsContent = () => {
        const currentWindowsLayoutClassName = [
            'fp-session-group-cards',
            'fp-current-window-group-cards',
            search?.trim() ? 'fp-content-search-mode' : viewMode === 'list' ? 'fp-content-list-mode' : '',
        ].filter(Boolean).join(' ');

        if (search?.trim()) {
            if (matchingCurrentWindows.length === 0) {
                return renderEmptyState();
            }

            return (
                <div className={currentWindowsLayoutClassName}>
                    {matchingCurrentWindows.map(({ windowSnapshot, matchingTabs }) => (
                        <FPCurrentWindowCard
                            key={windowSnapshot.windowId}
                            windowSnapshot={windowSnapshot}
                            onSelect={onSelectCurrentWindow}
                            onFocusWindow={onFocusCurrentWindow}
                            onSaveAsCollection={onSaveCurrentWindow}
                            onCloseWindow={onCloseCurrentWindow}
                            search={search}
                            matchingTabs={matchingTabs}
                        />
                    ))}
                </div>
            );
        }

        if (filteredCurrentWindows.length === 0) {
            return renderEmptyState();
        }

        return (
            <div className={currentWindowsLayoutClassName}>
                {filteredCurrentWindows.map((windowSnapshot) => (
                    <FPCurrentWindowCard
                        key={windowSnapshot.windowId}
                        windowSnapshot={windowSnapshot}
                        onSelect={onSelectCurrentWindow}
                        onFocusWindow={onFocusCurrentWindow}
                        onSaveAsCollection={onSaveCurrentWindow}
                        onCloseWindow={onCloseCurrentWindow}
                    />
                ))}
            </div>
        );
    };

    const renderCollectionCards = (
        collectionsToRender,
        {
            hideFolderMeta = false,
            sectionId = null,
            bulkSelectionAccentColor = contentHeading.accentColor,
        } = {},
    ) => {
        const normalizedSectionId = sectionId === ROOT_LEVEL_SECTION_ID ? null : sectionId;
        const previewBelongsToSection = !!previewTarget && previewTarget.parentId === normalizedSectionId;
        const isGroupedGridCrossSectionPreview = shouldRenderGroupedAllCollections &&
            viewMode === 'grid' &&
            previewTarget?.kind === collectionDropKinds.collection &&
            previewTarget.parentId !== activeParentId;
        const shouldUseSortableTransforms = shouldRenderGroupedAllCollections
            ? viewMode === 'grid' && !isGroupedGridCrossSectionPreview
            : canReorderFlatCollections;
        const shouldHideGroupedSourceCard = shouldRenderGroupedAllCollections &&
            viewMode === 'list' &&
            activeCollection?.uid &&
            activeCollection.uid !== undefined &&
            activeCollection.uid !== null;
        const renderInsertGap = (gapKey) => (
            <div
                key={gapKey}
                className={`fp-collection-insert-gap${viewMode === 'list' ? ' fp-content-list-mode' : ''}`}
                aria-hidden="true"
            />
        );

        return collectionsToRender.flatMap((collection) => {
            const items = [];
            const wrapperClassName = '';
            const revealMeta = activeCardRevealMap.get(collection.uid);
            const cardActiveId = (
                shouldRenderGroupedAllCollections && viewMode === 'grid'
            )
                ? null
                : activeCollection?.uid;

            if (
                shouldRenderGroupedAllCollections &&
                (
                    viewMode === 'list' ||
                    isGroupedGridCrossSectionPreview
                ) &&
                previewBelongsToSection &&
                previewTarget?.kind === collectionDropKinds.collection &&
                previewTarget.collectionId === collection.uid &&
                previewTarget.side === collectionDropSides.before &&
                !shouldUseSortableTransforms
            ) {
                items.push(renderInsertGap(`gap-before-${collection.uid}`));
            }

            items.push(
                <MemoizedSortableFPCard
                    key={collection.uid}
                    id={collection.uid}
                    collection={collection}
                    index={collectionIndexMap.get(collection.uid) ?? -1}
                    activeId={cardActiveId}
                    disableDrag={disableCollectionDragAndDrop}
                    suppressTransforms={!shouldUseSortableTransforms}
                    hideWhileDragging={shouldHideGroupedSourceCard && activeCollection?.uid === collection.uid}
                    collapseWhileDragging={shouldRenderGroupedAllCollections && viewMode === 'list'}
                    removeFromFlowWhileDragging={false}
                    wrapperClassName={wrapperClassName}
                    isRevealActive={!!revealMeta}
                    revealIndex={revealMeta?.index ?? -1}
                    reducedMotionReveal={revealMeta?.reducedMotion === true}
                    onSelect={handleSelectCollection}
                    updateCollection={updateCollection}
                    removeCollection={removeCollection}
                    updateRemoteData={updateRemoteData}
                    addCollection={addCollection}
                    onDataUpdate={onDataUpdate}
                    isAutoUpdate={trackedCollectionUids?.has(collection.uid) === true}
                    viewMode={viewMode}
                    search={search}
                    enableDropZone={!hasSearchQuery}
                    folderName={!hideFolderMeta && collection.parentId ? folderNameMap[collection.parentId] : null}
                    folderColor={!hideFolderMeta && collection.parentId ? folderColorMap[collection.parentId] : null}
                    onCardContextMenu={hasSelectedCollections ? undefined : handleCardContextMenu}
                    isInteractionActive={cardCtxMenu?.collection?.uid === collection.uid}
                    bulkSelectionActive={hasSelectedCollections}
                    isBulkSelected={selectedCollectionUids.has(collection.uid)}
                    onToggleBulkSelected={handleToggleCollectionSelection}
                    bulkSelectionAccentColor={bulkSelectionAccentColor}
                    folders={folders}
                />,
            );

            if (
                shouldRenderGroupedAllCollections &&
                (
                    viewMode === 'list' ||
                    isGroupedGridCrossSectionPreview
                ) &&
                previewBelongsToSection &&
                previewTarget?.kind === collectionDropKinds.collection &&
                previewTarget.collectionId === collection.uid &&
                previewTarget.side === collectionDropSides.after &&
                !shouldUseSortableTransforms
            ) {
                items.push(renderInsertGap(`gap-after-${collection.uid}`));
            }

            return items;
        });
    };

    const renderCollectionList = (
        collectionsToRender,
        {
            hideFolderMeta = false,
            sectionId = null,
            bulkSelectionAccentColor = contentHeading.accentColor,
            wrapperClassName = '',
            beforeContent = null,
            afterContent = null,
        } = {},
    ) => {
        const content = renderCollectionCards(collectionsToRender, {
            hideFolderMeta,
            sectionId,
            bulkSelectionAccentColor,
        });

        return (
            <SortableContext
                items={collectionsToRender.map((collection) => collection.uid)}
                strategy={viewMode === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
            >
                {wrapperClassName ? (
                    <div className={wrapperClassName}>
                        {beforeContent}
                        {content}
                        {afterContent}
                    </div>
                ) : (
                    <>
                        {beforeContent}
                        {content}
                        {afterContent}
                    </>
                )}
            </SortableContext>
        );
    };

    const renderGroupedAllCollections = () => (
        groupedSections.map((section) => {
            const isRootSection = section.kind === 'root';
            const isCollapsed = !isRootSection && section.collapsed;
            const isRevealTarget = activeSectionReveal?.sectionId === section.id;
            const headerLabel = isRootSection ? section.title : section.folder.name;
            const sectionColor = !isRootSection && section.folder?.uid
                ? folderColorMap[section.folder.uid]
                : null;
            const normalizedSectionParentId = isRootSection ? null : section.id;
            const previewBelongsToSection = previewTarget?.parentId === normalizedSectionParentId;
            const isAmbientSectionTarget = !!activeCollection && normalizedSectionParentId !== activeParentId;
            const isCollapsedSectionTarget = isCollapsed &&
                previewBelongsToSection &&
                (
                    previewTarget?.kind === collectionDropKinds.sectionStart ||
                    previewTarget?.kind === collectionDropKinds.sectionEnd ||
                    previewTarget?.kind === collectionDropKinds.sectionEmpty
                );
            return (
                <div
                    key={section.id}
                    className={`fp-grouped-section fp-grouped-section-${section.kind}${isCollapsed ? ' collapsed' : ''}`}
                >
                    <FPSectionDropZone
                        className={`fp-grouped-section-header-dropzone${isCollapsed ? ' collapsed' : ''}${isAmbientSectionTarget ? ' dnd-drop-ambient' : ''}`}
                        parentId={normalizedSectionParentId}
                        canHighlight={isCollapsedSectionTarget}
                    >
                        <div
                            className={`fp-grouped-section-header${!isRootSection ? ' clickable' : ''}${isRevealTarget ? ' fp-grouped-section-header-reveal' : ''}${isRevealTarget && activeSectionReveal?.reducedMotion ? ' reduced-motion' : ''}`}
                            onClick={!isRootSection ? () => handleToggleFolderSection(section.folder) : undefined}
                            onContextMenu={!isRootSection ? (event) => handleFolderContextMenu(event, section.folder) : undefined}
                            role={!isRootSection ? 'button' : undefined}
                            tabIndex={!isRootSection ? 0 : undefined}
                            onKeyDown={!isRootSection ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleToggleFolderSection(section.folder);
                                }
                            } : undefined}
                            data-section-id={section.id}
                            data-section-reveal={isRevealTarget ? 'true' : undefined}
                        >
                            <div className="fp-grouped-section-title-wrap">
                                {!isRootSection && (
                                    <span className="fp-grouped-section-toggle" aria-hidden="true">
                                        {isCollapsed ? <MdExpandMore size={20} /> : <MdExpandLess size={20} />}
                                    </span>
                                )}
                                {!isRootSection && (
                                    <span
                                        className="fp-grouped-section-color-indicator"
                                        style={{ '--fp-section-color': sectionColor }}
                                        aria-hidden="true"
                                    />
                                )}
                                <span className="fp-grouped-section-title">{headerLabel}</span>
                                <span className="fp-grouped-section-count">{section.count}</span>
                                <span className="fp-grouped-section-divider" aria-hidden="true" />
                            </div>
                        </div>
                    </FPSectionDropZone>

                    {!isCollapsed && (
                        <div
                            className={`fp-grouped-section-body ${viewMode === 'list' ? 'fp-content-list-mode' : ''}`}
                            data-grouped-section-body-parent-id={normalizedSectionParentId ?? ROOT_LEVEL_SECTION_ID}
                        >
                            {section.collections.length > 0 ? (
                                <>
                                    <FPSectionEdgeDropZone
                                        id={`section-start-${section.id}`}
                                        label={`Drop at start of ${headerLabel}`}
                                        parentId={normalizedSectionParentId}
                                        dragType={collectionDropKinds.sectionStart}
                                        canHighlight={false}
                                    />
                                    {renderCollectionList(section.collections, {
                                        hideFolderMeta: true,
                                        sectionId: section.id,
                                        bulkSelectionAccentColor: contentHeading.accentColor,
                                        wrapperClassName: `fp-grouped-section-items ${viewMode === 'list' ? 'fp-content-list-mode' : ''}`,
                                        beforeContent: previewBelongsToSection && previewTarget?.kind === collectionDropKinds.sectionStart ? (
                                            <div
                                                className={`fp-collection-insert-gap${viewMode === 'list' ? ' fp-content-list-mode' : ''}`}
                                                aria-hidden="true"
                                            />
                                        ) : null,
                                        afterContent: previewBelongsToSection && previewTarget?.kind === collectionDropKinds.sectionEnd ? (
                                            <div
                                                className={`fp-collection-insert-gap${viewMode === 'list' ? ' fp-content-list-mode' : ''}`}
                                                aria-hidden="true"
                                            />
                                        ) : null,
                                    })}
                                    <FPSectionEdgeDropZone
                                        id={`section-end-${section.id}`}
                                        label={`Drop at end of ${headerLabel}`}
                                        parentId={normalizedSectionParentId}
                                        dragType={collectionDropKinds.sectionEnd}
                                        className="fp-grouped-append-dropzone"
                                        canHighlight={false}
                                    />
                                </>
                            ) : (
                                <FPSectionContentDropZone
                                    id={`empty-${section.id}`}
                                    className={`fp-grouped-empty-dropzone-wrapper${viewMode === 'list' ? ' fp-content-list-mode' : ''}${isAmbientSectionTarget ? ' dnd-drop-ambient' : ''}`}
                                    parentId={normalizedSectionParentId}
                                    canHighlight={previewBelongsToSection && previewTarget?.kind === collectionDropKinds.sectionEmpty}
                                >
                                    <div className="fp-grouped-empty-dropzone">
                                        {isRootSection ? 'Drop collections here to keep them at the root level.' : 'Drop collections here to move them into this folder.'}
                                    </div>
                                </FPSectionContentDropZone>
                            )}
                        </div>
                    )}
                </div>
            );
        })
    );

    const hasRenderableCollections = shouldRenderGroupedAllCollections
        ? displayCollections.length > 0 || folders.length > 0
        : displayCollections.length > 0;

    return (
        <div className="fp-content">
            <div
                className="fp-content-title-row"
                style={{ '--fp-heading-accent': contentHeading.accentColor }}
            >
                <FPBadge accent={contentHeading.accentColor} className="fp-content-heading-badge">{contentHeading.badge}</FPBadge>
                <h2 className="fp-content-title">{contentHeading.title}</h2>
                <span className="fp-content-heading-count">{contentHeading.countLabel}</span>
                {contentHeading.subtitle && (
                    <>
                        <span className="fp-content-heading-sep" aria-hidden="true">·</span>
                        <p className="fp-content-heading-subtitle">{contentHeading.subtitle}</p>
                    </>
                )}
            </div>

            {/* Centered floating toolbar — hidden for lightweight live views */}
            {!isLightweightView && (
                <div className="fp-toolbar-wrapper fp-toolbar-wrapper-floating fp-toolbar-stack">
                    <div className="fp-toolbar fp-toolbar-default">
                        {renderDefaultCollectionToolbarControls()}
                    </div>
                    <div
                        className={`fp-bulk-toolbar-slot${hasSelectedCollections ? ' is-visible' : ''}`}
                        aria-hidden={!hasSelectedCollections}
                    >
                        {hasSelectedCollections && (
                            <div className="fp-toolbar fp-bulk-toolbar">
                                {renderSelectedCollectionToolbarControls()}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Lightweight views: minimal toolbar with view toggle */}
            {isLightweightView && (
                <div className="fp-toolbar-wrapper fp-toolbar-wrapper-floating">
                    <div className="fp-toolbar">
                        {renderSelectedTabToolbarControls()}

                        <div className="fp-toolbar-group">
                            {isCurrentWindowsView && currentWindows.length > 0 && (
                                <button
                                    className="fp-toolbar-btn fp-toolbar-primary-btn"
                                    onClick={() => setIsSaveAllWindowsModalOpen(true)}
                                    aria-label="Save All Windows"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Save all open windows as a new folder"
                                >
                                    <MdSave size={18} />
                                </button>
                            )}
                            {isCurrentWindowsView && (
                                <button
                                    className="fp-toolbar-btn"
                                    onClick={toggleViewMode}
                                    aria-label={viewModeToggleTooltip}
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content={viewModeToggleTooltip}
                                    disabled={hasSearchQuery}
                                >
                                    {viewMode === 'grid' ? <MdViewList size={20} /> : <PiGridNineFill size={20} />}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileSelection}
                style={{ display: 'none' }}
            />

            {/* Lightweight live views */}
            {isLightweightView ? (
                <div className={`fp-content-sessions ${isCurrentWindowsView ? 'fp-content-sessions-current-windows' : ''}`.trim()}>
                    {isSessionsView ? renderSessionsContent() : renderCurrentWindowsContent()}
                </div>
            ) : (
                /* Grid / List */
                <div
                    ref={contentScrollRef}
                    className={`fp-content-grid ${showEntranceAnimation ? 'fp-content-animate-entrance' : ''} ${search ? 'fp-content-search-mode' : viewMode === 'list' ? 'fp-content-list-mode' : ''} ${shouldRenderGroupedAllCollections ? 'fp-content-grouped-mode' : ''}`}
                >
                    {isFavoritesView ? (
                        <FPFavoritesSection
                            collections={collections}
                            viewMode={viewMode}
                            search={search}
                            disableDrag={hasSearchQuery || hasSelectedCollections}
                            updateCollection={updateCollection}
                            removeCollection={removeCollection}
                            updateRemoteData={updateRemoteData}
                            addCollection={addCollection}
                            onDataUpdate={onDataUpdate}
                            onSelect={handleSelectCollection}
                            onCardContextMenu={hasSelectedCollections ? undefined : handleCardContextMenu}
                            trackedCollectionUids={trackedCollectionUids}
                            folders={folders}
                        />
                    ) : hasRenderableCollections ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={customCollisionDetection}
                            onDragStart={handleDragStart}
                            onDragMove={handleDragMove}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                            onDragCancel={resetDragState}
                            measuring={measuring}
                        >
                            {shouldRenderGroupedAllCollections ? (
                                renderGroupedAllCollections()
                            ) : (
                                renderCollectionList(displayCollections)
                            )}
                            <DragOverlay
                                adjustScale={false}
                                dropAnimation={null}
                            >
                                {activeCollection ? (
                                    <div
                                        className="fp-card-drag-overlay dnd-drag-overlay"
                                        data-fp-drag-overlay="true"
                                        style={activeDragRectRef.current ? { width: activeDragRectRef.current.width, height: activeDragRectRef.current.height } : undefined}
                                    >
                                        <FPCollectionCard
                                            collection={activeCollection}
                                            updateCollection={updateCollection}
                                            removeCollection={removeCollection}
                                            updateRemoteData={updateRemoteData}
                                            addCollection={addCollection}
                                            onDataUpdate={onDataUpdate}
                                            isAutoUpdate={trackedCollectionUids?.has(activeCollection.uid) === true}
                                            viewMode={viewMode}
                                            folders={folders}
                                        />
                                    </div>
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    ) : (
                        renderEmptyState()
                    )}
                </div>
            )}

            {/* Save session as collection modal — reuses SaveCollectionModal */}
            <Suspense fallback={null}>
                <SaveCollectionModal
                    isOpen={!!saveCollectionRequest}
                    onClose={() => setSaveCollectionRequest(null)}
                    folders={folders}
                    addCollection={addCollection}
                    addFolder={addFolder}
                    onDataUpdate={onDataUpdate}
                    onSaved={(savedCollection) => {
                        if (saveCollectionRequest?.clearSelectedTabsOnSaved) {
                            clearSelectedTabSessions();
                        }
                        queueRevealBatch(savedCollection);
                    }}
                    sessionCollection={saveCollectionRequest?.sessionCollection || null}
                    snapshotCollection={saveCollectionRequest?.snapshotCollection || null}
                />
            </Suspense>

            <Suspense fallback={null}>
                <SaveCollectionModal
                    isOpen={isSaveAllWindowsModalOpen}
                    onClose={() => setIsSaveAllWindowsModalOpen(false)}
                    folders={folders}
                    addCollection={addCollection}
                    addFolder={addFolder}
                    onDataUpdate={onDataUpdate}
                    onSaved={queueRevealBatch}
                    initialSaveMode="all"
                    lockSaveMode={true}
                />
            </Suspense>

            <Suspense fallback={null}>
                <LegacyImportPreviewModal
                    isOpen={!!legacyImportPreviewData}
                    onClose={() => {
                        if (isImportingLegacyPreview) {
                            return;
                        }
                        setLegacyImportPreviewData(null);
                        setParsedLegacyImportData(null);
                    }}
                    onConfirm={handleConfirmLegacyImport}
                    previewData={legacyImportPreviewData}
                    isImporting={isImportingLegacyPreview}
                />
            </Suspense>

            {/* Session restore modal (from + menu) */}
            <Modal
                isOpen={isSessionModalOpen}
                onRequestClose={() => setIsSessionModalOpen(false)}
                className="modal-content"
                overlayClassName="modal-overlay"
                ariaHideApp={false}
            >
                <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>}>
                    <SessionsModal
                        isOpen={isSessionModalOpen}
                        sessions={sessionList}
                        addCollection={addCollection}
                        onClose={() => setIsSessionModalOpen(false)}
                    />
                </Suspense>
            </Modal>

            {/* Folder modal */}
            <Suspense fallback={null}>
                <CreateFolderModalBase
                    isOpen={folderModalOpen}
                    onClose={() => setFolderModalOpen(false)}
                    onSave={handleFolderSave}
                />
            </Suspense>

            <Suspense fallback={null}>
                <CreateFolderModalBase
                    isOpen={!!editFolder}
                    onClose={() => setEditFolder(null)}
                    onSave={handleFolderEdit}
                    folder={editFolder}
                />
            </Suspense>

            <Suspense fallback={null}>
                <FolderDeleteConfirmModal
                    isOpen={!!deleteModal}
                    onClose={() => setDeleteModal(null)}
                    onConfirm={handleDeleteConfirm}
                    folderName={deleteModal?.folder?.name || ''}
                    collectionCount={deleteModal?.collectionCount || 0}
                />
            </Suspense>

            <Suspense fallback={null}>
                <BulkMoveCollectionsModal
                    isOpen={isBulkMoveModalOpen}
                    onClose={() => setIsBulkMoveModalOpen(false)}
                    onConfirm={handleConfirmBulkMoveCollections}
                    folders={folders}
                    selectedCount={selectedVisibleCollections.length}
                />
            </Suspense>

            <Suspense fallback={null}>
                <BulkDeleteCollectionsModal
                    isOpen={isBulkDeleteModalOpen}
                    onClose={() => setIsBulkDeleteModalOpen(false)}
                    onConfirm={handleConfirmBulkDeleteCollections}
                    selectedCount={selectedVisibleCollections.length}
                />
            </Suspense>

            {/* Right-click context menu for collection cards */}
            {cardCtxMenu && createPortal(
                <div
                    ref={cardCtxMenuRef}
                    className="fp-card-ctx-menu"
                    style={{ top: cardCtxMenu.y, left: cardCtxMenu.x }}
                >
                    <button
                        className="fp-card-ctx-item"
                        onClick={() => handleCtxMenuAction(
                            cardCtxMenu.isAutoUpdate
                                ? cardCtxMenu.operations._handleFocusWindow
                                : cardCtxMenu.operations._handleOpenTabs
                        )}
                    >
                        {cardCtxMenu.isAutoUpdate
                            ? <MdCenterFocusWeak size={16} />
                            : <FaPlay size={12} />
                        }
                        <span>{cardCtxMenu.isAutoUpdate ? 'Focus Window' : 'Open Tabs'}</span>
                    </button>
                    <div className="fp-card-ctx-divider" />
                    {!cardCtxMenu.isAutoUpdate && (
                        <button
                            className="fp-card-ctx-item"
                            onClick={() => handleCtxMenuAction(cardCtxMenu.operations._handleUpdate)}
                        >
                            <MdOutlineRefresh size={16} />
                            <span>Update Collection</span>
                        </button>
                    )}
                    {cardCtxMenu.isAutoUpdate && (
                        <button
                            className="fp-card-ctx-item"
                            onClick={() => handleCtxMenuAction(cardCtxMenu.operations._handleStopTracking)}
                        >
                            <FaStop size={14} />
                            <span>Stop Auto Update</span>
                        </button>
                    )}
                    <button
                        className="fp-card-ctx-item"
                        onClick={() => handleCtxMenuAction(cardCtxMenu.operations._exportCollectionToFile)}
                    >
                        <CiExport size={16} />
                        <span>Export Collection</span>
                    </button>
                    <button
                        className="fp-card-ctx-item"
                        onClick={() => handleCtxMenuAction(cardCtxMenu.operations._handleDuplicate)}
                    >
                        <MdContentCopy size={16} />
                        <span>Duplicate Collection</span>
                    </button>
                    <button
                        className="fp-card-ctx-item"
                        onClick={() => handleCtxMenuAction(cardCtxMenu.operations._handleToggleFavorite)}
                    >
                        {cardCtxMenu.collection.isFavorite ? <FaStar size={14} /> : <FaRegStar size={14} />}
                        <span>{cardCtxMenu.collection.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                    </button>
                    <button
                        className="fp-card-ctx-item"
                        onClick={() => { const c = cardCtxMenu.collection; setCardCtxMenu(null); handleCopyCollectionUrls(c); }}
                    >
                        <MdContentCopy size={16} />
                        <span>Copy all URLs</span>
                    </button>
                    {aiEnabled && (cardCtxMenu.collection.tabs?.length || 0) >= SPLIT_MIN_TABS && (
                        <button
                            className="fp-card-ctx-item"
                            onClick={() => { const c = cardCtxMenu.collection; setCardCtxMenu(null); handleSplitCollection(c); }}
                        >
                            <MdCallSplit size={16} />
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <AiBadge />
                                Split Collection
                            </span>
                        </button>
                    )}
                    <div className="fp-card-ctx-divider" />
                    <button
                        className="fp-card-ctx-item fp-card-ctx-danger"
                        onClick={() => handleCtxMenuAction(cardCtxMenu.operations._handleDelete)}
                    >
                        <MdDelete size={16} />
                        <span>Delete Collection</span>
                    </button>
                </div>,
                document.body
            )}

            {folderCtxMenu && createPortal(
                <div
                    ref={folderCtxMenuRef}
                    className="fp-sidebar-ctx-menu"
                    style={{ top: folderCtxMenu.y, left: folderCtxMenu.x }}
                >
                    {buildFolderMenuItems({
                        folder: folderCtxMenu.folder,
                        onShare: handleFolderCtxShare,
                        onDelete: handleFolderCtxDelete,
                        onLeave: handleFolderCtxLeave,
                        onUnshare: handleFolderCtxUnshare,
                        isPro,
                        existingItems: [
                            { id: 'open-all', text: 'Open All Collections', icon: <MdOpenInBrowser size={16} />, action: handleFolderCtxOpenAll, condition: true },
                            { id: 'edit', text: 'Edit Folder', icon: <MdEdit size={16} />, action: handleFolderCtxEdit, condition: true },
                            { id: 'export', text: 'Export Folder', icon: <CiExport size={16} />, action: handleFolderCtxExport, condition: true },
                            { id: 'duplicate', text: 'Duplicate Folder', icon: <MdContentCopy size={16} />, action: handleFolderCtxDuplicate, condition: true },
                            { id: 'copy-folder-urls', text: 'Copy all URLs in folder', icon: <MdContentCopy size={16} />, action: handleFolderCtxCopyUrls, condition: true },
                        ],
                    }).map((item, index, items) => {
                        const isGroupBStart = item.id === 'open-all';
                        const groupCIds = ['unshare', 'leave-shared', 'delete'];
                        const isGroupCStart = groupCIds.includes(item.id) && !groupCIds.includes(items[index - 1]?.id);
                        return (
                            <React.Fragment key={item.id}>
                                {(isGroupBStart || isGroupCStart) && index > 0 && <div className="fp-sidebar-ctx-divider" />}
                                <button
                                    className={`fp-sidebar-ctx-item ${item.className === 'danger' ? 'fp-sidebar-ctx-danger' : ''}`.trim()}
                                    onClick={item.action}
                                >
                                    {item.icon || FOLDER_MENU_ICONS[item.id]} <span>{item.text}</span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>,
                document.body
            )}
        </div>
    );
}

export default FPContentArea;
export { SortableFPCard };
