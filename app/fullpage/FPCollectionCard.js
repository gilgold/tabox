import React, { useEffect, useMemo } from 'react';
import { MdCenterFocusWeak, MdOutlineRefresh } from 'react-icons/md';
import { FaTrash, FaPlay } from 'react-icons/fa';
import { BsIncognito } from 'react-icons/bs';
import ContextMenu from '../ContextMenu';
import { createCollectionMenuItems } from '../utils/contextMenuItems';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { highlightedCollectionUidState, deletingCollectionUidsState } from '../atoms/animationsState';
import { selectedCollectionUidState } from '../atoms/globalAppSettingsState';
import { getColorValue } from '../utils/colorMigration';
import ColorPicker from '../ColorPicker';
import { useCollectionOperations } from '../useCollectionOperations';
import DroppableCollection from '../DroppableCollection';
import { highlightText, getMatchingTabs } from '../utils/searchUtils';
import FPCardBase from './FPCardBase';
import MultiSelectCheckbox from '../MultiSelectCheckbox';

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
    onCardContextMenu,
    bulkSelectionActive = false,
    isBulkSelected = false,
    onToggleBulkSelected,
    bulkSelectionAccentColor = null,
}) {
    const highlightedCollectionUid = useAtomValue(highlightedCollectionUidState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const deletingCollectionUids = useAtomValue(deletingCollectionUidsState);
    const setDeletingCollectionUids = useSetAtom(deletingCollectionUidsState);
    const selectedCollectionUid = useAtomValue(selectedCollectionUidState);

    const isHighlighted = highlightedCollectionUid === collection.uid;
    const isDeleting = deletingCollectionUids.has(collection.uid);
    const isSelected = selectedCollectionUid === collection.uid;
    const showBulkSelection = typeof onToggleBulkSelected === 'function';

    const {
        _handleDelete,
        _handleDuplicate,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleFocusWindow,
        _handleStopTracking,
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

    const colorValue = collection.color && collection.color !== 'default'
        ? getColorValue(collection.color)
        : 'var(--primary-color)';

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

    const meta = (
        <>
            <span className="fp-card-meta-chip tabs">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
            {groupCount > 0 && (
                <span className="fp-card-meta-chip groups">{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
            )}
            {folderName && (
                <span className="fp-card-meta-chip folder">
                    <span className="fp-card-folder-dot" style={{ backgroundColor: folderDotColor }} />
                    {folderName}
                </span>
            )}
            {!!search?.trim() && matchingTabs.length > 0 && (
                <span className="fp-card-meta-chip fp-card-meta-match-badge">
                    {matchingTabs.length} tab match{matchingTabs.length !== 1 ? 'es' : ''}
                </span>
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
            })}
            tooltip="More options"
        />
    );

    const actions = bulkSelectionActive ? null : (
        <>
            <div className="fp-card-color-picker">
                <ColorPicker
                    currentColor={collection.color}
                    action={(newColor) => {
                        const updated = { ...collection, color: newColor, lastUpdated: Date.now() };
                        updateCollection(updated, true);
                    }}
                    tooltip="Change color"
                />
            </div>
            <button
                type="button"
                className="fp-card-action-btn primary"
                tabIndex={-1}
                onClick={() => isAutoUpdate ? _handleFocusWindow() : _handleOpenTabs()}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={isAutoUpdate ? 'Focus window' : 'Open tabs'}
            >
                {isAutoUpdate ? <MdCenterFocusWeak size={14} /> : <FaPlay size={10} />}
                <span>{isAutoUpdate ? 'Focus' : 'Open'}</span>
            </button>
            <div className="fp-card-action-secondary">
                <button
                    type="button"
                    className="fp-card-action-btn secondary"
                    tabIndex={-1}
                    onClick={_handleUpdate}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Update with current tabs"
                >
                    <MdOutlineRefresh size={13} />
                    <span>Update</span>
                </button>
                <button
                    type="button"
                    className="fp-card-action-btn secondary danger"
                    tabIndex={-1}
                    onClick={_handleDelete}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Delete"
                >
                    <FaTrash size={10} />
                    <span>Delete</span>
                </button>
            </div>
        </>
    );

    return (
        <DroppableCollection collection={collection}>
            <FPCardBase
                className={[
                    activeId === collection.uid ? 'fp-card-dragging' : '',
                    isAutoUpdate ? 'fp-card-tracking' : '',
                    isHighlighted ? 'fp-card-highlighted' : '',
                    isDeleting ? 'fp-card-deleting' : '',
                    lightningEffect ? 'fp-card-lightning' : '',
                    isSelected ? 'fp-card-selected' : '',
                    bulkSelectionActive ? 'fp-card-bulk-mode' : '',
                    isBulkSelected ? 'fp-card-bulk-selected' : '',
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
                actionMenu={actionMenu}
                actions={actions}
                dragAttributes={dragAttributes}
                dragListeners={dragListeners}
            />
        </DroppableCollection>
    );
}

export default FPCollectionCard;
