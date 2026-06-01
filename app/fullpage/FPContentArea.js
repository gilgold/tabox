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
import ColorPicker from '../ColorPicker';
import {
    DndContext,
    pointerWithin,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    MeasuringStrategy,
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
} from 'react-icons/md';
import { FaPlay } from 'react-icons/fa';
import { FaStop } from 'react-icons/fa6';
import { CiExport } from 'react-icons/ci';
import { PiGridNineFill } from 'react-icons/pi';
import { TbFileImport } from 'react-icons/tb';
import { browser } from '../../static/globals';
import { showSuccessToast, showErrorToast } from '../toastHelpers';
import Modal from 'react-modal';
import './FPContentArea.css';
import useCollectionItemCrossDrag from '../useCollectionItemCrossDrag';
import { downloadTextFile } from '../utils';
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
    applyCollectionDropOperation,
    collectionDropKinds,
    collectionDropSides,
    getAffectedCollectionParentIds,
    getCollectionTargetSide,
    normalizeCollectionParentId,
    resolveCollectionDropOperation,
    resolveCollectionDropTarget,
    sortCollectionsWithinParent,
} from '../utils/collectionSectionDragEngine';
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

const SessionsModal = lazy(() => import('../SessionsModal').then(m => ({ default: m.SessionsModal })));
const SaveCollectionModal = lazy(() => import('./SaveCollectionModal'));
const BulkMoveCollectionsModal = lazy(() => import('./BulkMoveCollectionsModal'));
const BulkDeleteCollectionsModal = lazy(() => import('./BulkDeleteCollectionsModal'));

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

const getDragOverlayCenter = () => {
    if (typeof document === 'undefined') {
        return null;
    }

    const overlayElement = document.querySelector('[data-fp-drag-overlay="true"]');
    if (!overlayElement) {
        return null;
    }

    const rect = overlayElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return {
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
    };
};

const getActualPointerCoordinates = (event) => {
    const clientX = event?.activatorEvent?.clientX;
    const clientY = event?.activatorEvent?.clientY;
    const deltaX = event?.delta?.x;
    const deltaY = event?.delta?.y;

    if (
        typeof clientX === 'number' &&
        typeof clientY === 'number' &&
        typeof deltaX === 'number' &&
        typeof deltaY === 'number'
    ) {
        return {
            x: clientX + deltaX,
            y: clientY + deltaY,
        };
    }

    const translatedRect = event?.active?.rect?.current?.translated;
    if (
        translatedRect &&
        typeof translatedRect.left === 'number' &&
        typeof translatedRect.top === 'number' &&
        typeof translatedRect.width === 'number' &&
        typeof translatedRect.height === 'number'
    ) {
        return {
            x: translatedRect.left + (translatedRect.width / 2),
            y: translatedRect.top + (translatedRect.height / 2),
        };
    }

    return null;
};

const getPointerCoordinates = (event) => {
    const overlayCenter = getDragOverlayCenter();
    if (overlayCenter) {
        return overlayCenter;
    }

    return getActualPointerCoordinates(event);
};

const findGroupedSectionBodyTargetAtPoint = (point) => {
    if (!point || typeof document === 'undefined') {
        return null;
    }

    const sectionBodies = Array.from(document.querySelectorAll('[data-grouped-section-body-parent-id]'));

    for (const body of sectionBodies) {
        const rect = body.getBoundingClientRect();
        const rawParentId = body.getAttribute('data-grouped-section-body-parent-id');
        const parentId = rawParentId === ROOT_LEVEL_SECTION_ID ? null : rawParentId;
        const cards = Array.from(body.querySelectorAll('[data-sortable-collection-id]'))
            .filter((card) => {
                const cardRect = card.getBoundingClientRect();
                return cardRect.width > 0 && cardRect.height > 0;
            });

        if (cards.length === 0) {
            const emptySectionTopSlack = 32;
            const emptySectionBottomSlack = 64;
            if (
                point.x < rect.left ||
                point.x > rect.right ||
                point.y < rect.top - emptySectionTopSlack ||
                point.y > rect.bottom + emptySectionBottomSlack
            ) {
                continue;
            }

            return {
                kind: collectionDropKinds.sectionEmpty,
                parentId,
            };
        }

        const firstRect = cards[0].getBoundingClientRect();
        const lastRect = cards[cards.length - 1].getBoundingClientRect();
        const sectionLeft = Math.min(rect.left, firstRect.left, lastRect.left);
        const sectionRight = Math.max(rect.right, firstRect.right, lastRect.right);
        const topBandSlack = Math.max(24, Math.min(40, firstRect.height / 2));
        const bottomBandSlack = Math.max(24, Math.min(40, lastRect.height / 2));
        const extraBottomHit = 64;

        if (point.x < sectionLeft || point.x > sectionRight) {
            continue;
        }

        if (
            point.y >= firstRect.top - topBandSlack &&
            point.y <= firstRect.top + topBandSlack
        ) {
            return {
                kind: collectionDropKinds.sectionStart,
                parentId,
            };
        }

        if (
            point.y >= lastRect.bottom - bottomBandSlack &&
            point.y <= lastRect.bottom + extraBottomHit
        ) {
            return {
                kind: collectionDropKinds.sectionEnd,
                parentId,
            };
        }
    }

    return null;
};

const findGroupedEmptySectionTargetAtPoint = (point) => {
    if (!point || typeof document === 'undefined') {
        return null;
    }

    const sectionBodies = Array.from(document.querySelectorAll('[data-grouped-section-body-parent-id]'));

    for (const body of sectionBodies) {
        const rect = body.getBoundingClientRect();
        const cards = Array.from(body.querySelectorAll('[data-sortable-collection-id]'))
            .filter((card) => {
                const cardRect = card.getBoundingClientRect();
                return cardRect.width > 0 && cardRect.height > 0;
            });

        if (cards.length > 0) {
            continue;
        }

        const hitSlop = 18;
        if (
            point.x < rect.left - hitSlop ||
            point.x > rect.right + hitSlop ||
            point.y < rect.top - hitSlop ||
            point.y > rect.bottom + hitSlop
        ) {
            continue;
        }

        const rawParentId = body.getAttribute('data-grouped-section-body-parent-id');
        return {
            kind: collectionDropKinds.sectionEmpty,
            parentId: rawParentId === ROOT_LEVEL_SECTION_ID ? null : rawParentId,
        };
    }

    return null;
};

const findGroupedGridCollectionTargetAtPoint = (point, activeId, folderUidSet) => {
    if (!point || typeof document === 'undefined') {
        return null;
    }

    const sectionBodies = Array.from(document.querySelectorAll('[data-grouped-section-body-parent-id]'));

    for (const body of sectionBodies) {
        const rect = body.getBoundingClientRect();
        if (
            point.x < rect.left ||
            point.x > rect.right ||
            point.y < rect.top ||
            point.y > rect.bottom
        ) {
            continue;
        }

        const rawParentId = body.getAttribute('data-grouped-section-body-parent-id');
        const parentId = rawParentId === ROOT_LEVEL_SECTION_ID ? null : rawParentId;
        const cards = Array.from(body.querySelectorAll('[data-sortable-collection-id]'))
            .map((card) => {
                const collectionId = card.getAttribute('data-sortable-collection-id');
                const cardRect = card.getBoundingClientRect();
                return { collectionId, rect: cardRect };
            })
            .filter(({ collectionId, rect }) => (
                collectionId &&
                collectionId !== activeId &&
                rect.width > 0 &&
                rect.height > 0
            ));

        if (cards.length === 0) {
            return {
                kind: collectionDropKinds.sectionEmpty,
                parentId,
            };
        }

        const nearestCard = cards.reduce((closest, candidate) => {
            const candidateCenterX = candidate.rect.left + (candidate.rect.width / 2);
            const candidateCenterY = candidate.rect.top + (candidate.rect.height / 2);
            const candidateDistance = Math.hypot(point.x - candidateCenterX, point.y - candidateCenterY);

            if (!closest || candidateDistance < closest.distance) {
                return {
                    collectionId: candidate.collectionId,
                    rect: candidate.rect,
                    distance: candidateDistance,
                };
            }

            return closest;
        }, null);

        if (!nearestCard) {
            return null;
        }

        return {
            kind: collectionDropKinds.collection,
            parentId,
            collectionId: nearestCard.collectionId,
            side: getCollectionTargetSide({
                viewMode: 'grid',
                point,
                rect: nearestCard.rect,
            }),
        };
    }

    return null;
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
        opacity: isDragging && !hideWhileDragging ? 0.5 : undefined,
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
    const highlightedCollectionUid = useAtomValue(highlightedCollectionUidState);
    const [disableDrag, setDisableDrag] = useState(false);
    const [showEntranceAnimation, setShowEntranceAnimation] = useState(true);
    const [activeCollection, setActiveCollection] = useState(null);
    const [previewTarget, setPreviewTarget] = useState(null);
    const previewTargetRef = useRef(null);
    const lastMeaningfulDropTargetRef = useRef(null);
    const [activeSectionReveal, setActiveSectionReveal] = useState(null);
    const [activeCardReveal, setActiveCardReveal] = useState(null);
    const activeDragRectRef = useRef(null);
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
                const aStr = (aVal || '').toString().toLowerCase();
                const bStr = (bVal || '').toString().toLowerCase();
                return sortAscending ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
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
    const isMixedParentFlatView = !shouldRenderGroupedAllCollections && (
        hasSearchQuery ||
        hasActiveFilters
    );
    const canReorderFlatCollections = !isMixedParentFlatView && (
        sidebarNavigation === 'unorganized' ||
        (
            sidebarNavigation !== 'all' &&
            sidebarNavigation !== 'sessions'
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
                showColorIndicator: true,
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
                    showColorIndicator: false,
                };
            }
            if (isSessionsView) {
                return {
                    badge: 'Search results',
                    title: 'Recently Closed',
                    subtitle: searchSubtitle,
                    countLabel: sessionCountLabel,
                    accentColor: '#F59E0B',
                    showColorIndicator: false,
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
                showColorIndicator: false,
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
                    showColorIndicator: false,
                };
            case 'unorganized':
                return {
                    badge: 'Library area',
                    title: 'No Folder',
                    subtitle: 'Collections still sitting at the root level',
                    countLabel: collectionCountLabel,
                    accentColor: 'var(--primary-color)',
                    showColorIndicator: false,
                };
            case 'current-windows':
                return {
                    badge: 'Live view',
                    title: 'Current Windows',
                    subtitle: 'Open browser windows available right now',
                    countLabel: currentWindowCountLabel,
                    accentColor: CURRENT_WINDOWS_ACCENT_COLOR,
                    showColorIndicator: false,
                };
            case 'sessions':
                return {
                    badge: 'History',
                    title: 'Recently Closed',
                    subtitle: 'Recently closed tabs and windows from this browser',
                    countLabel: sessionCountLabel,
                    accentColor: '#F59E0B',
                    showColorIndicator: false,
                };
            default:
                return {
                    badge: 'Collections',
                    title: 'Collections',
                    subtitle: 'Saved collections in this section',
                    countLabel: collectionCountLabel,
                    accentColor: 'var(--primary-color)',
                    showColorIndicator: false,
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

    // Sortable items
    const sortableItems = useMemo(() => displayCollections.map(c => c.uid), [displayCollections]);

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

    const handleFolderCtxDelete = useCallback(async () => {
        if (!folderCtxMenu) return;
        const folder = folderCtxMenu.folder;
        closeFolderCtxMenu();
        const collectionCount = groupedSectionCollectionsMap.get(folder.uid)?.length || 0;
        if (collectionCount > 0) {
            setDeleteModal({ folder, collectionCount });
            return;
        }

        const result = await deleteFolder(folder.uid, true, false);
        if (result.success) {
            showSuccessToast('Folder deleted');
            if (onDataUpdate) await onDataUpdate();
        } else {
            showErrorToast('Failed to delete folder');
        }
    }, [folderCtxMenu, closeFolderCtxMenu, groupedSectionCollectionsMap, onDataUpdate]);

    const handleDeleteConfirm = useCallback(async (deleteCollections) => {
        if (!deleteModal) return;
        const { folder } = deleteModal;
        setDeleteModal(null);
        const result = await deleteFolder(folder.uid, true, deleteCollections);
        if (result.success) {
            const msg = deleteCollections
                ? `Folder and ${result.collectionsDeleted} collection(s) deleted`
                : `Folder deleted (${result.collectionsMovedToRoot} collection(s) moved to root)`;
            showSuccessToast(msg);
            if (onDataUpdate) await onDataUpdate();
        } else {
            showErrorToast('Failed to delete folder');
        }
    }, [deleteModal, onDataUpdate]);

    const activeParentId = useMemo(() => (
        activeCollection ? normalizeCollectionParentId(activeCollection, folderUidSet) : null
    ), [activeCollection, folderUidSet]);

    const isSameParentCollectionPreview = useMemo(() => (
        !!previewTarget &&
        previewTarget.kind === collectionDropKinds.collection &&
        previewTarget.parentId === activeParentId
    ), [previewTarget, activeParentId]);

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

    // DnD
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const customCollisionDetection = useCallback((args) => {
        if (dragSession) {
            return [];
        }

        const activeId = args.active?.id;
        const pointerCollisions = pointerWithin(args);
        const getCollisionParentId = (collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            const dataParentId = collision?.data?.droppableContainer?.data?.current?.parentId;

            if (
                dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty
            ) {
                return dataParentId || null;
            }

            const collisionId = typeof collision?.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision?.id;
            const collection = displayCollections.find((entry) => entry.uid === collisionId);
            return collection ? normalizeCollectionParentId(collection, folderUidSet) : undefined;
        };
        const pointerCollectionTargets = pointerCollisions.filter((collision) => {
            const collisionId = typeof collision.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision.id;
            return collisionId !== activeId && displayCollections.some((collection) => collection.uid === collisionId);
        });
        const pointerSectionTargets = pointerCollisions.filter((collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            return dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty;
        });
        const cornerCollisions = closestCorners(args);
        const allCollisions = [...pointerCollisions, ...cornerCollisions];
        const uniqueCollisions = allCollisions.filter((collision, index, array) => (
            index === array.findIndex((entry) => entry.id === collision.id)
        ));
        const collectionTargets = uniqueCollisions.filter((collision) => {
            const collisionId = typeof collision.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision.id;
            return collisionId !== activeId && displayCollections.some((collection) => collection.uid === collisionId);
        });
        const sectionTargets = uniqueCollisions.filter((collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            return dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty;
        });

        if (shouldRenderGroupedAllCollections) {
            if (pointerCollectionTargets.length > 0) {
                return pointerCollectionTargets;
            }

            if (viewMode === 'grid') {
                if (pointerSectionTargets.length > 0) {
                    const hoveredParentId = getCollisionParentId(pointerSectionTargets[0]);
                    const cornerCollectionTargets = closestCorners(args).filter((collision) => {
                        const collisionId = typeof collision.id === 'string' && collision.id.startsWith('collection-drop-')
                            ? collision.id.slice('collection-drop-'.length)
                            : collision.id;
                        if (collisionId === activeId || !displayCollections.some((collection) => collection.uid === collisionId)) {
                            return false;
                        }

                        return getCollisionParentId(collision) === hoveredParentId;
                    });

                    if (cornerCollectionTargets.length > 0) {
                        return cornerCollectionTargets;
                    }

                    return pointerSectionTargets;
                }

                return [];
            }

            if (pointerSectionTargets.length > 0) {
                return pointerSectionTargets;
            }

            if (collectionTargets.length > 0) {
                return collectionTargets;
            }

            if (sectionTargets.length > 0) {
                return sectionTargets;
            }

            return [];
        }

        if (canReorderFlatCollections) {
            if (collectionTargets.length > 0) {
                return collectionTargets;
            }

            return [];
        }

        return [];
    }, [
        canReorderFlatCollections,
        dragSession,
        displayCollections,
        folderUidSet,
        shouldRenderGroupedAllCollections,
        viewMode,
    ]);

    const measuring = {
        droppable: { strategy: MeasuringStrategy.Always },
        dragOverlay: { strategy: MeasuringStrategy.Always },
    };

    const resetDragState = useCallback(() => {
        setActiveCollection(null);
        setPreviewTarget(null);
        previewTargetRef.current = null;
        lastMeaningfulDropTargetRef.current = null;
        setDraggingCollection(null);
        activeDragRectRef.current = null;
    }, [setDraggingCollection]);

    const handleDragStart = (event) => {
        if (dragSession || hasSearchQuery) {
            resetDragState();
            return;
        }

        const col = sourceCollections.find(c => c.uid === event.active.id);
        if (col) {
            setActiveCollection(col);
            setDraggingCollection({ collection: col });
        }
        activeDragRectRef.current = null;
        setPreviewTarget(null);
        previewTargetRef.current = null;
        lastMeaningfulDropTargetRef.current = null;

        // Measure the original card so the overlay matches its grid size.
        const activeId = String(event.active.id);
        const escapedId = window.CSS?.escape ? window.CSS.escape(activeId) : activeId.replace(/"/g, '\\"');
        const sourceEl = document.querySelector(`[data-sortable-collection-id="${escapedId}"]`);
        if (sourceEl) {
            const r = sourceEl.getBoundingClientRect();
            activeDragRectRef.current = { width: r.width, height: r.height };
        } else {
            const initial = event.active?.rect?.current?.initial;
            if (initial && initial.width > 0) {
                activeDragRectRef.current = { width: initial.width, height: initial.height };
            }
        }
    };

    const getCollectionTargetRect = (collectionId) => {
        if (!collectionId || typeof document === 'undefined') {
            return null;
        }

        const escapedId = window.CSS?.escape
            ? window.CSS.escape(collectionId)
            : collectionId.replace(/"/g, '\\"');
        const element = document.querySelector(`[data-sortable-collection-id="${escapedId}"]`);

        return element?.getBoundingClientRect() || null;
    };

    const handleDragOver = (event) => {
        if (dragSession || hasSearchQuery) {
            resetDragState();
            return;
        }

        const baseTarget = resolveCollectionDropTarget({
            over: event.over,
            collections: displayCollections,
            folderUidSet,
        });
        const point = getPointerCoordinates(event);
        const pointerPoint = getActualPointerCoordinates(event) || point;
        const groupedEmptySectionTarget = shouldRenderGroupedAllCollections && pointerPoint
            ? findGroupedEmptySectionTargetAtPoint(pointerPoint)
            : null;
        const groupedGridCollectionTarget = (
            shouldRenderGroupedAllCollections &&
            viewMode === 'grid' &&
            pointerPoint &&
            groupedEmptySectionTarget?.kind !== collectionDropKinds.sectionEmpty &&
            baseTarget?.kind !== collectionDropKinds.collection
        )
            ? findGroupedGridCollectionTargetAtPoint(pointerPoint, activeCollection?.uid, folderUidSet)
            : null;
        const sectionBodyTarget = shouldRenderGroupedAllCollections && viewMode === 'list'
            ? findGroupedSectionBodyTargetAtPoint(pointerPoint)
            : null;
        let nextTarget = groupedEmptySectionTarget || groupedGridCollectionTarget || sectionBodyTarget || baseTarget;

        if (
            shouldRenderGroupedAllCollections &&
            viewMode === 'grid' &&
            nextTarget &&
            (
                nextTarget.kind === collectionDropKinds.sectionStart ||
                nextTarget.kind === collectionDropKinds.sectionEnd
            )
        ) {
            const destinationCollections = groupedSectionCollectionsMap.get(nextTarget.parentId) || [];
            if (destinationCollections.length > 0) {
                nextTarget = {
                    kind: collectionDropKinds.collection,
                    parentId: nextTarget.parentId,
                    collectionId: nextTarget.kind === collectionDropKinds.sectionStart
                        ? destinationCollections[0].uid
                        : destinationCollections[destinationCollections.length - 1].uid,
                    side: nextTarget.kind === collectionDropKinds.sectionStart
                        ? collectionDropSides.before
                        : collectionDropSides.after,
                };
            }
        }

        if (!nextTarget || !activeCollection) {
            setPreviewTarget(null);
            previewTargetRef.current = null;
            return;
        }

        if (nextTarget.kind === collectionDropKinds.collection) {
            if (nextTarget.collectionId === activeCollection.uid) {
                return;
            }

            const rect = getCollectionTargetRect(nextTarget.collectionId);
            const side = nextTarget.side || getCollectionTargetSide({
                viewMode,
                point: pointerPoint || point,
                rect,
            });

            const resolvedTarget = {
                ...nextTarget,
                side,
            };

            setPreviewTarget(resolvedTarget);
            previewTargetRef.current = resolvedTarget;
            lastMeaningfulDropTargetRef.current = resolvedTarget;
            return;
        }

        setPreviewTarget(nextTarget);
        previewTargetRef.current = nextTarget;
        lastMeaningfulDropTargetRef.current = nextTarget;
    };

    const findSidebarDropTarget = (x, y) => {
        const folderItems = document.querySelectorAll('[data-sidebar-folder-uid]');
        for (const item of folderItems) {
            const rect = item.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return item.getAttribute('data-sidebar-folder-uid');
            }
        }
        const noFolderItem = document.querySelector('[data-sidebar-no-folder]');
        if (noFolderItem) {
            const rect = noFolderItem.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return 'no-folder';
            }
        }
        return null;
    };

    const handleDragEnd = async (event) => {
        if (dragSession || hasSearchQuery) {
            resetDragState();
            return;
        }

        const { active } = event;
        const draggedCollection = sourceCollections.find(collection => collection.uid === active.id);
        const draggedParentId = draggedCollection
            ? normalizeCollectionParentId(draggedCollection, folderUidSet)
            : null;

        // Check for cross-context sidebar drop using the actual pointer position
        // at drop time. Computed from dnd-kit's activatorEvent + accumulated delta.
        const finalX = event.activatorEvent.clientX + event.delta.x;
        const finalY = event.activatorEvent.clientY + event.delta.y;
        const sidebarTarget = findSidebarDropTarget(finalX, finalY);

        if (sidebarTarget && draggedCollection) {
            const targetParentId = sidebarTarget === 'no-folder' ? null : sidebarTarget;

            if (targetParentId !== draggedParentId) {
                const sidebarOperation = resolveCollectionDropOperation({
                    collections: sourceCollections,
                    folders,
                    activeId: active.id,
                    target: {
                        kind: collectionDropKinds.sectionEnd,
                        parentId: targetParentId,
                    },
                    viewMode,
                    sortBy: sortByField,
                    sortOrder,
                });
                const nextCollections = applyCollectionDropOperation({
                    collections: sourceCollections,
                    folders,
                    operation: sidebarOperation,
                    sortBy: sortByField,
                    sortOrder,
                });

                if (nextCollections) {
                    await persistCollectionChanges(nextCollections, getAffectedCollectionParentIds(sidebarOperation));
                    setHighlightedCollectionUid(draggedCollection.uid);
                    if (targetParentId && triggerFolderLightningEffect) {
                        triggerFolderLightningEffect(targetParentId);
                    }
                }
            }

            resetDragState();
            return;
        }

        const finalPreviewTarget = previewTargetRef.current || lastMeaningfulDropTargetRef.current;

        if (!finalPreviewTarget || !draggedCollection) {
            resetDragState();
            return;
        }

        const operation = resolveCollectionDropOperation({
            collections: sourceCollections,
            folders,
            activeId: active.id,
            target: finalPreviewTarget,
            viewMode,
            sortBy: sortByField,
            sortOrder,
        });
        const nextCollections = applyCollectionDropOperation({
            collections: sourceCollections,
            folders,
            operation,
            sortBy: sortByField,
            sortOrder,
        });

        if (nextCollections) {
            await persistCollectionChanges(nextCollections, getAffectedCollectionParentIds(operation));
            setHighlightedCollectionUid(draggedCollection.uid);
            if (
                finalPreviewTarget.parentId &&
                finalPreviewTarget.parentId !== draggedParentId &&
                triggerFolderLightningEffect
            ) {
                triggerFolderLightningEffect(finalPreviewTarget.parentId);
            }
        }

        resetDragState();
    };

    // Sort handler — uses flatSort so all collections sort globally regardless of folder
    const handleSort = async (sortBy, ascending) => {
        const { loadAllCollections, batchUpdateCollections } = await import('../utils/storageUtils');
        const sortFieldMap = { 'DATE': 'lastUpdated', 'NAME': 'name', 'COLOR': 'color' };
        const sortByField = sortFieldMap[sortBy] || 'lastUpdated';
        const sortOrder = ascending ? 'asc' : 'desc';
        const allCols = await loadAllCollections({ metadataOnly: false, sortBy: sortByField, sortOrder, flatSort: true });
        const cleared = allCols.map(c => ({ ...c, order: null }));
        await batchUpdateCollections(cleared);
        const reloaded = await loadAllCollections({ metadataOnly: false, sortBy: sortByField, sortOrder, flatSort: true });
        const cleaned = reloaded.map(({ order, ...rest }) => rest);
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
    }, [loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

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
    }, [folders, loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

    const handleBulkRemoveFromFolder = useCallback(async () => {
        const { selectedIdSet, allCollections, selectedCollections } = await loadSelectedCollectionSnapshot();
        const removableCollections = selectedCollections.filter((collection) => !!collection.parentId);
        if (removableCollections.length === 0) {
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

        const affectedFolderIds = new Set(removableCollections.map((collection) => collection.parentId).filter(Boolean));

        await updateRemoteData(nextCollections);
        await Promise.all([...affectedFolderIds].map((folderId) => updateFolderCollectionCount(folderId)));
        if (onDataUpdate) {
            await onDataUpdate();
        }

        showSuccessToast(`Removed ${removableCollections.length} collection${removableCollections.length !== 1 ? 's' : ''} from folder${removableCollections.length !== 1 ? 's' : ''}`);
    }, [loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

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

        const success = await batchDeleteCollections(selectedIds);
        if (!success) {
            showErrorToast('Failed to delete collections');
            return;
        }

        const remainingCollections = allCollections.filter((collection) => !selectedIdSet.has(collection.uid));
        const affectedFolderIds = new Set(selectedCollections.map((collection) => collection.parentId).filter(Boolean));

        await updateRemoteData(remainingCollections);
        await Promise.all([...affectedFolderIds].map((folderId) => updateFolderCollectionCount(folderId)));

        clearSelectedCollections();
        setIsBulkDeleteModalOpen(false);
        if (onDataUpdate) {
            await onDataUpdate();
        }

        showSuccessToast(`Deleted ${selectedCollections.length} collection${selectedCollections.length !== 1 ? 's' : ''}`);
    }, [batchDeleteCollections, clearSelectedCollections, loadSelectedCollectionSnapshot, onDataUpdate, updateRemoteData]);

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
                        className={`fp-grouped-section-header-dropzone${isCollapsed ? ' collapsed' : ''}`}
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
                                    className={`fp-grouped-empty-dropzone-wrapper${viewMode === 'list' ? ' fp-content-list-mode' : ''}`}
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
                className="fp-content-title-row fp-floating-header-row"
                style={{ '--fp-heading-accent': contentHeading.accentColor }}
            >
                <div className="fp-content-heading fp-content-heading-compact fp-floating-header-shell">
                    <div className="fp-content-heading-meta">
                        <FPBadge accent={contentHeading.accentColor} className="fp-content-heading-badge">{contentHeading.badge}</FPBadge>
                        {contentHeading.showColorIndicator && (
                            <span
                                className="fp-content-heading-color-indicator"
                                aria-hidden="true"
                            />
                        )}
                    </div>
                    <div className="fp-content-heading-main fp-content-heading-main-inline">
                        <h2 className="fp-content-title">{contentHeading.title}</h2>
                        <div className="fp-content-heading-supporting fp-content-heading-supporting-inline">
                            <span className="fp-content-heading-count">{contentHeading.countLabel}</span>
                            {contentHeading.subtitle && (
                                <p className="fp-content-heading-subtitle">{contentHeading.subtitle}</p>
                            )}
                        </div>
                    </div>
                </div>
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
                    {hasRenderableCollections ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={customCollisionDetection}
                            onDragStart={handleDragStart}
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
                                        className="fp-card-drag-overlay"
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
                    <button className="fp-sidebar-ctx-item" onClick={handleFolderCtxOpenAll}>
                        <MdOpenInBrowser size={16} /> <span>Open All Collections</span>
                    </button>
                    <div className="fp-sidebar-ctx-divider" />
                <button className="fp-sidebar-ctx-item" onClick={handleFolderCtxEdit}>
                    <MdEdit size={16} /> <span>Edit Folder</span>
                </button>
                <button className="fp-sidebar-ctx-item" onClick={handleFolderCtxExport}>
                    <CiExport size={16} /> <span>Export Folder</span>
                </button>
                    <button className="fp-sidebar-ctx-item" onClick={handleFolderCtxDuplicate}>
                        <MdContentCopy size={16} /> <span>Duplicate Folder</span>
                    </button>
                    <div className="fp-sidebar-ctx-divider" />
                    <button className="fp-sidebar-ctx-item fp-sidebar-ctx-danger" onClick={handleFolderCtxDelete}>
                        <MdDelete size={16} /> <span>Delete Folder</span>
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
}

export default FPContentArea;
export { SortableFPCard };
