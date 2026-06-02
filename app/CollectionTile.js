import React, { useEffect, useState, useMemo, useRef, useEffectEvent } from 'react';
import { MdCenterFocusWeak, MdOutlineLaunch } from 'react-icons/md';
import { FaTrash } from 'react-icons/fa';
import { BsIncognito } from 'react-icons/bs';

import ContextMenu from './ContextMenu';
import { createCollectionMenuItems } from './utils/contextMenuItems';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { highlightedCollectionUidState, deletingCollectionUidsState } from './atoms/animationsState';
import { trackingStateVersion } from './atoms/globalAppSettingsState';

import { getColorValue } from './utils/colorMigration';
import ColorPicker from './ColorPicker';
import { useCollectionOperations } from './useCollectionOperations';
import { browser } from '../static/globals';
import './CollectionTile.css';
import DroppableCollection from './DroppableCollection';

function CollectionTile(props) {
    const highlightedCollectionUid = useAtomValue(highlightedCollectionUidState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const deletingCollectionUids = useAtomValue(deletingCollectionUidsState);
    const setDeletingCollectionUids = useSetAtom(deletingCollectionUidsState);
    const [collectionName, setCollectionName] = useState(props.collection.name);
    const [isAutoUpdate, setIsAutoUpdate] = useState(false);
    const mountedRef = useRef(true);

    // Check if this tile should be highlighted
    const isHighlighted = highlightedCollectionUid === props.collection.uid;
    
    // Check if this tile is being deleted
    const isDeleting = deletingCollectionUids.has(props.collection.uid);

    // Use shared collection operations
    const {
        _handleDelete,
        _handleDuplicate,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleFocusWindow,
        _handleStopTracking
    } = useCollectionOperations({
        collection: props.collection,
        removeCollection: props.removeCollection,
        updateCollection: props.updateCollection,
        updateRemoteData: props.updateRemoteData,
        setIsAutoUpdate,
        index: props.index,
        setDeletingCollectionUids,
        addCollection: props.addCollection,
        onDataUpdate: props.onDataUpdate
    });

    // Handle highlight effect
    useEffect(() => {
        if (isHighlighted) {
            // Clear highlight after animation completes
            const timer = setTimeout(() => {
                setHighlightedCollectionUid(null);
            }, 700); // Highlight animation duration (was 1200ms, now 700ms)
            
            return () => clearTimeout(timer);
        }
    }, [isHighlighted, setHighlightedCollectionUid]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Use Effect Event for checking auto-update status
    const checkAutoUpdate = useEffectEvent(async () => {
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        collectionsToTrack = collectionsToTrack || [];
        const isTracking = collectionsToTrack.some(c => c.collectionUid === props.collection.uid);
        if (mountedRef.current) {
            setIsAutoUpdate(chkEnableAutoUpdate && isTracking);
        }
    });

    // Check auto-update status on mount and when collection UID changes
    useEffect(() => {
        checkAutoUpdate();
    }, [props.collection.uid]);
    
    // PERFORMANCE FIX: Watch global tracking version instead of individual storage listener
    // This prevents having N storage listeners (one per collection)
    const trackingVersion = useAtomValue(trackingStateVersion);
    useEffect(() => {
                checkAutoUpdate();
    }, [trackingVersion]);

    const _handleTileClick = (e) => {
        // Prevent tile click if clicking on interactive elements
        if (e.target.classList.contains('tile-action-button') ||
            e.target.closest('.tile-action-button') ||
            e.target.classList.contains('tile-actions') ||
            e.target.closest('.tile-actions') ||
            e.target.classList.contains('tile-hover-menu') ||
            e.target.closest('.tile-hover-menu') ||
            e.target.classList.contains('tile-menu-item') ||
            e.target.closest('.tile-menu-item') ||
            e.target.classList.contains('tile-color-picker') ||
            e.target.closest('.tile-color-picker') ||
            e.target.classList.contains('color-picker') ||
            e.target.closest('.color-picker') ||
            e.target.classList.contains('action-icon') ||
            e.target.closest('.action-icon') ||
            e.target.classList.contains('menu-icon') ||
            e.target.closest('.menu-icon')) {
            return;
        }
        // Open detail panel if onSelect is provided, otherwise open tabs
        if (props.onSelect) {
            props.onSelect(props.collection);
        } else {
            _handleOpenTabs();
        }
    };

    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    const tabCount = props.collection.tabs?.length || 0;
    const groupCount = props.collection.chromeGroups?.length || 0;

    // Get first 10 favicons
    const favicons = useMemo(() => {
        const tabs = props.collection.tabs || [];
        return tabs.slice(0, 10).map(tab => tab.favIconUrl).filter(Boolean);
    }, [props.collection.tabs]);
    const formatTimeAgo = (timestamp) => {
        try {
            return timeAgo.format(new Date(timestamp));
        } catch (error) {
            return 'Recently';
        }
    };

    // Check if collection was recently opened (last 3 hours)
    const isRecentlyOpened = useMemo(() => {
        if (!props.collection.lastOpened) return false;
        const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
        return props.collection.lastOpened >= threeHoursAgo;
    }, [props.collection.lastOpened]);

    // Check if collection was saved from incognito
    const wasFromIncognito = props.collection.savedFromIncognito === true;

    // Helper function to escape regex special characters
    const escapeRegex = (string) => {
        return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    };

    // Highlight matching text in collection name for search
    const highlightMatchInName = useMemo(() => {
        if (!props.search || !props.search.trim()) return null;
        const name = props.collection.name;
        const searchTerm = props.search.trim();
        const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
        if (!name || !name.match(searchRegex)) return null;
        const parts = name.split(new RegExp(`(${escapeRegex(searchTerm)})`, 'gi'));
        return parts.map((part, index) => {
            if (part.toLowerCase() === searchTerm.toLowerCase()) {
                return <span key={`match-${index}`} className="search-match-text">{part}</span>;
            }
            return part ? <span key={`text-${index}`}>{part}</span> : null;
        }).filter(Boolean);
    }, [props.search, props.collection.name]);

    // Count matching tabs for badge
    const matchingTabsCount = useMemo(() => {
        if (!props.search || !props.search.trim()) return 0;
        const searchRegex = new RegExp(escapeRegex(props.search), 'i');
        return (props.collection.tabs || []).filter(tab =>
            tab.title?.match(searchRegex) || tab.url?.match(searchRegex)
        ).length;
    }, [props.search, props.collection.tabs]);

    return (
        <DroppableCollection collection={props.collection}>
            <div
                className={`collection-tile ${props.activeId === props.collection.uid ? 'dragging' : ''} ${isAutoUpdate ? 'active-auto-tracking' : ''} ${isHighlighted ? 'new-tile-highlight' : ''} ${isDeleting ? 'new-tile-deleting' : ''} ${props.lightningEffect ? 'lightning-effect' : ''}`}
                style={{
                    ...(props.collection.color && props.collection.color !== 'default' && props.collection.color !== 'var(--setting-row-border-color)' && props.collection.color !== 'var(--collection-default-color)' && { borderColor: getColorValue(props.collection.color) })
                }}
                onClick={_handleTileClick}
                {...props.dragAttributes}
                {...props.dragListeners}
            >

            {/* Collection name */}
            <div className="tile-header">
                <div className="tile-title-row">
                    <h3 className="tile-title" title={collectionName}>
                        {highlightMatchInName !== null ? highlightMatchInName : collectionName}
                    </h3>
                    {wasFromIncognito && (
                        <span 
                            className="incognito-indicator" 
                            title="Saved from incognito window"
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content="Saved from incognito window"
                        >
                            <BsIncognito />
                        </span>
                    )}
                    {isRecentlyOpened && (
                        <span className="recently-opened-indicator" title="Recently opened (last 3 hours)"></span>
                    )}
                </div>
            </div>

            {/* Favicons grid */}
            <div className="tile-favicons">
                {favicons.map((favicon, index) => (
                    <img
                        key={index}
                        src={favicon}
                        alt=""
                        className="tile-favicon"
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                ))}
                {favicons.length === 0 && (
                    <div className="no-favicons">No tabs</div>
                )}
            </div>

            {/* Folder label (fullpage only) */}
            {props.folderName && (
                <div className="tile-folder-label">{props.folderName}</div>
            )}

            {/* Footer */}
            <div className="tile-footer">
                <div className="tile-stats">
                    {tabCount} tabs and {groupCount} groups
                </div>
                <div className="tile-time">
                    {formatTimeAgo(props.collection.lastUpdated || props.collection.createdOn)}
                </div>
            </div>

            {/* Matching tabs badge */}
            {matchingTabsCount > 0 && (
                <div className="tile-matching-badge">
                    {matchingTabsCount} tab match{matchingTabsCount !== 1 ? 'es' : ''}
                </div>
            )}

            {/* Action buttons */}
            <div
                className="tile-actions tile-hover-menu"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className="tile-action-button tile-menu-item play-button"
                    onClick={(e) => { e.stopPropagation(); _handleOpenTabs(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={isAutoUpdate ? "Focus collection window" : "Open collection tabs"}
                    data-tooltip-id="main-tooltip" data-tooltip-content={isAutoUpdate ? "Focus collection window" : "Open collection tabs"}
                    data-tooltip-place="right"
                    data-tooltip-class-name="small-tooltip"
                >
                    {isAutoUpdate ? <MdCenterFocusWeak /> : <MdOutlineLaunch />}
                    <span className="tile-menu-label">{isAutoUpdate ? 'Focus' : 'Open'}</span>
                </button>

                <div
                    className="tile-menu-item tile-menu-option"
                >
                    <ContextMenu
                        menuItems={createCollectionMenuItems({
                            isAutoUpdate,
                            onExport: _exportCollectionToFile,
                            onDelete: _handleDelete,
                            onUpdate: _handleUpdate,
                            onStopTracking: _handleStopTracking,
                            onDuplicate: _handleDuplicate
                        })}
                        tooltip="Collection options"
                        tooltipPlace="right"
                    />
                    <span className="tile-menu-label">More</span>
                </div>

                <div
                    className="tile-menu-item tile-menu-color"
                >
                    <ColorPicker
                        currentColor={props.collection.color}
                        action={(newColor) => {
                            const updatedCollection = { ...props.collection, color: newColor, lastUpdated: Date.now() };
                            props.updateCollection(updatedCollection, true); // Manual color change - trigger lightning effect
                        }}
                        tooltip="Change collection color"
                        tooltipPlace="right"
                    />
                    <span className="tile-menu-label">Color</span>
                </div>

                <button
                    type="button"
                    className="tile-action-button tile-menu-item delete-button"
                    onClick={(e) => { e.stopPropagation(); _handleDelete(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="Delete collection"
                    data-tooltip-id="main-tooltip" data-tooltip-content="Delete collection"
                    data-tooltip-place="right"
                    data-tooltip-class-name="small-tooltip"
                >
                    <FaTrash />
                    <span className="tile-menu-label">Delete</span>
                </button>
            </div>
        </div>
        </DroppableCollection>
    );
}

export default CollectionTile;
