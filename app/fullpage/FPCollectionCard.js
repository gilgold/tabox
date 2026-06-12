import React, { useEffect, useMemo, useState } from 'react';
import { MdCenterFocusWeak, MdOutlineLaunch, MdOutlineRefresh } from 'react-icons/md';
import { FaTrash, FaStar, FaRegStar } from 'react-icons/fa';
import { BsIncognito } from 'react-icons/bs';
import ContextMenu from '../ContextMenu';
import { createCollectionMenuItems } from '../utils/contextMenuItems';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { highlightedCollectionUidState, deletingCollectionUidsState } from '../atoms/animationsState';
import { selectedCollectionUidState } from '../atoms/globalAppSettingsState';
import { aiProcessingUidsState, aiProcessingCurrentUidState } from '../atoms/aiState';
import '../AIEffects.css';
import { getColorValue, normalizeColorKey } from '../utils/colorMigration';
import ColorPicker from '../ColorPicker';
import { useCollectionOperations } from '../useCollectionOperations';
import DroppableCollection from '../DroppableCollection';
import { highlightText, getMatchingTabs } from '../utils/searchUtils';
import FPCardBase from './FPCardBase';
import FPCardHoverActions, { FP_CARD_HOVER_MENU_CLASS } from './FPCardHoverActions';
import MultiSelectCheckbox from '../MultiSelectCheckbox';
import FPBadge from './FPBadge';

function FPCollectionCard({
    collection,
    activeId,
    onSelect,
    updateCollection,
    removeCollection,
    updateRemoteData,
    addCollection,
    onDataUpdate,
    index,
    lightningEffect,
    isAutoUpdate = false,
    search,
    folderName,
    folderColor,
    dragAttributes,
    dragListeners,
    enableDropZone = true,
    onCardContextMenu,
    bulkSelectionActive = false,
    isBulkSelected = false,
    onToggleBulkSelected,
    bulkSelectionAccentColor = null,
    viewMode = 'grid',
    isInteractionActive = false,
}) {
    const highlightedCollectionUid = useAtomValue(highlightedCollectionUidState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const deletingCollectionUids = useAtomValue(deletingCollectionUidsState);
    const setDeletingCollectionUids = useSetAtom(deletingCollectionUidsState);
    const selectedCollectionUid = useAtomValue(selectedCollectionUidState);
    const aiProcessingUids = useAtomValue(aiProcessingUidsState);
    const aiProcessingCurrentUid = useAtomValue(aiProcessingCurrentUidState);

    const isHighlighted = highlightedCollectionUid === collection.uid;
    const isDeleting = deletingCollectionUids.has(collection.uid);
    const isSelected = selectedCollectionUid === collection.uid;
    const isAiProcessing = aiProcessingUids.includes(collection.uid);
    const isAiCurrent = aiProcessingCurrentUid === collection.uid;
    const showBulkSelection = typeof onToggleBulkSelected === 'function';
    const [isLocalInteractionActive, setIsLocalInteractionActive] = useState(false);
    const shouldShowInteractionState = isInteractionActive || isLocalInteractionActive;

    const {
        _handleDelete,
        _handleDuplicate,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleFocusWindow,
        _handleStopTracking,
        _handleToggleFavorite,
    } = useCollectionOperations({
        collection,
        removeCollection,
        updateCollection,
        updateRemoteData,
        index,
        setDeletingCollectionUids,
        addCollection,
        onDataUpdate,
    });

    useEffect(() => {
        if (isHighlighted) {
            const timer = setTimeout(() => setHighlightedCollectionUid(null), 700);
            return () => clearTimeout(timer);
        }
    }, [isHighlighted, setHighlightedCollectionUid]);

    const handleCardKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect?.(collection);
        }
    };

    const handleContextMenu = (event) => {
        if (bulkSelectionActive) {
            return;
        }

        if (onCardContextMenu) {
            onCardContextMenu(event, collection, isAutoUpdate, {
                _handleOpenTabs,
                _handleFocusWindow,
                _handleUpdate,
                _handleDelete,
                _handleDuplicate,
                _exportCollectionToFile,
                _handleStopTracking,
                _handleToggleFavorite,
            });
        }
    };

    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    const tabCount = collection.tabs?.length || 0;
    const groupCount = collection.chromeGroups?.length || 0;

    const formatTimeAgo = (timestamp) => {
        try { return timeAgo.format(new Date(timestamp)); }
        catch { return 'Recently'; }
    };

    const isRecentlyOpened = useMemo(() => {
        if (!collection.lastOpened) {
            return false;
        }

        return collection.lastOpened >= Date.now() - (3 * 60 * 60 * 1000);
    }, [collection.lastOpened]);

    const wasFromIncognito = collection.savedFromIncognito === true;

    const hasCustomCollectionColor = normalizeColorKey(collection.color) !== 'default';
    const colorValue = hasCustomCollectionColor
        ? getColorValue(collection.color)
        : 'var(--collection-default-color)';

    const folderDotColor = folderColor || colorValue;
    const highlightedName = useMemo(() => (
        highlightText(collection.name, search, 'fp-card-search-match')
    ), [collection.name, search]);
    const matchingTabs = useMemo(() => getMatchingTabs(collection, search), [collection, search]);
    const handleToggleBulkSelection = (event) => {
        event.stopPropagation();
        onToggleBulkSelected?.(collection);
    };

    const titleBadges = (isRecentlyOpened || isAutoUpdate) ? (
        <div className="fp-card-badges">
            {isRecentlyOpened && (
                <span className="fp-card-badge recent" data-tooltip-id="main-tooltip" data-tooltip-content="Recently opened" />
            )}
            {isAutoUpdate && (
                <span className="fp-card-badge tracking" data-tooltip-id="main-tooltip" data-tooltip-content="Auto-tracking active" />
            )}
        </div>
    ) : null;

    const countMeta = (
        <>
            <FPBadge accent="tabs" className="fp-card-meta-chip fp-card-count-chip tabs">{tabCount} tab{tabCount !== 1 ? 's' : ''}</FPBadge>
            {groupCount > 0 && (
                <FPBadge accent="groups" className="fp-card-meta-chip fp-card-count-chip groups">{groupCount} group{groupCount !== 1 ? 's' : ''}</FPBadge>
            )}
        </>
    );

    const meta = (
        <>
            {folderName && (
                <FPBadge accent={folderDotColor} className="fp-card-meta-chip folder">
                    <span className="fp-card-folder-dot" style={{ backgroundColor: folderDotColor }} />
                    {folderName}
                </FPBadge>
            )}
            {!!search?.trim() && matchingTabs.length > 0 && (
                <FPBadge accent="match" className="fp-card-meta-chip fp-card-meta-match-badge">
                    {matchingTabs.length} tab match{matchingTabs.length !== 1 ? 'es' : ''}
                </FPBadge>
            )}
        </>
    );

    const actionMenu = bulkSelectionActive ? null : (
        <ContextMenu
            menuItems={createCollectionMenuItems({
                isAutoUpdate,
                onExport: _exportCollectionToFile,
                onDelete: _handleDelete,
                onUpdate: _handleUpdate,
                onStopTracking: _handleStopTracking,
                onDuplicate: _handleDuplicate,
                isFavorite: collection.isFavorite === true,
                onToggleFavorite: _handleToggleFavorite,
            })}
            tooltip="More options"
            tooltipPlace="right"
            onOpenChange={setIsLocalInteractionActive}
        />
    );

    const actions = bulkSelectionActive ? null : (
        <FPCardHoverActions
            items={[
                {
                    key: 'open',
                    className: 'fp-card-rail-open',
                    label: isAutoUpdate ? 'Focus' : 'Open',
                    tooltip: isAutoUpdate ? 'Focus window' : 'Open tabs',
                    ariaLabel: isAutoUpdate ? 'Focus window' : 'Open tabs',
                    icon: isAutoUpdate ? <MdCenterFocusWeak size={14} /> : <MdOutlineLaunch size={14} />,
                    onClick: () => isAutoUpdate ? _handleFocusWindow() : _handleOpenTabs(),
                },
                {
                    key: 'update',
                    className: 'fp-card-rail-update',
                    label: 'Update',
                    tooltip: 'Update with current tabs',
                    icon: <MdOutlineRefresh size={13} />,
                    onClick: _handleUpdate,
                },
                {
                    key: 'favorite',
                    className: `fp-card-rail-favorite${collection.isFavorite ? ' is-favorite' : ''}`,
                    label: collection.isFavorite ? 'Unfavorite' : 'Favorite',
                    tooltip: collection.isFavorite ? 'Remove from favorites' : 'Add to favorites',
                    ariaLabel: collection.isFavorite ? 'Remove from favorites' : 'Add to favorites',
                    icon: collection.isFavorite ? <FaStar size={12} /> : <FaRegStar size={12} />,
                    onClick: _handleToggleFavorite,
                },
                {
                    key: 'more',
                    className: 'fp-card-menu-option',
                    label: 'More',
                    render: () => actionMenu,
                },
                {
                    key: 'color',
                    className: 'fp-card-color-picker',
                    label: 'Color',
                    render: () => (
                        <ColorPicker
                            currentColor={collection.color}
                            action={(newColor) => {
                                const updated = { ...collection, color: newColor, lastUpdated: Date.now() };
                                updateCollection(updated, true);
                            }}
                            tooltip="Change color"
                            tooltipPlace="right"
                            onOpenChange={setIsLocalInteractionActive}
                        />
                    ),
                },
                {
                    key: 'delete',
                    className: 'fp-card-rail-delete',
                    label: 'Delete',
                    tooltip: 'Delete',
                    icon: <FaTrash size={10} />,
                    onClick: _handleDelete,
                },
            ]}
        />
    );

    return (
        <DroppableCollection collection={collection} disabled={!enableDropZone}>
            <FPCardBase
                className={[
                    'fp-collection-card',
                    activeId === collection.uid ? 'fp-card-dragging' : '',
                    isAutoUpdate ? 'fp-card-tracking' : '',
                    isHighlighted ? 'fp-card-highlighted' : '',
                    isDeleting ? 'fp-card-deleting' : '',
                    lightningEffect ? 'fp-card-lightning' : '',
                    isSelected ? 'fp-card-selected' : '',
                    bulkSelectionActive ? 'fp-card-bulk-mode' : '',
                    isBulkSelected ? 'fp-card-bulk-selected' : '',
                    shouldShowInteractionState ? 'fp-card-interaction-active' : '',
                ].filter(Boolean).join(' ')}
                style={{
                    '--card-color': colorValue,
                    '--bulk-selection-accent': bulkSelectionAccentColor || colorValue,
                }}
                onClick={() => onSelect?.(collection)}
                onContextMenu={handleContextMenu}
                onKeyDown={handleCardKeyDown}
                ariaLabel={`Open collection ${collection.name}`}
                title={highlightedName !== null ? highlightedName : collection.name}
                titleText={collection.name}
                titleRowClassName={viewMode === 'list' ? 'fp-card-title-row-list' : ''}
                titleLeading={(
                    <>
                        {showBulkSelection && (
                            <MultiSelectCheckbox
                                className="fp-card-bulk-select-btn"
                                checked={isBulkSelected}
                                aria-label={isBulkSelected ? `Deselect collection ${collection.name}` : `Select collection ${collection.name}`}
                                accentColor={bulkSelectionAccentColor || colorValue}
                                tabIndex={-1}
                                onClick={handleToggleBulkSelection}
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                            />
                        )}
                        {wasFromIncognito ? (
                            <span className="fp-card-incognito-icon" data-tooltip-id="main-tooltip" data-tooltip-content="Saved from incognito">
                                <BsIncognito size={20} />
                            </span>
                        ) : null}
                    </>
                )}
                titleBadges={titleBadges}
                meta={meta}
                footerLeadingMeta={countMeta}
                timeLabel={formatTimeAgo(collection.lastUpdated || collection.createdOn)}
                tabs={collection.tabs || []}
                matchingTabs={matchingTabs}
                search={search}
                onOpenMatchingTab={(tab) => {
                    if (tab.url) {
                        browser.tabs.create({ url: tab.url, active: true });
                    }
                }}
                matchingTabsResetKey={collection.uid}
                matchingTabsTabIndex={-1}
                actionMenu={null}
                actions={actions}
                actionsClassName={FP_CARD_HOVER_MENU_CLASS}
                dragAttributes={dragAttributes}
                dragListeners={dragListeners}
                extraContent={isAiProcessing ? (
                    <div className={`ai-processing-overlay${isAiCurrent ? ' ai-processing-overlay--current' : ''}`} aria-hidden="true" />
                ) : null}
            />
        </DroppableCollection>
    );
}

export default FPCollectionCard;
