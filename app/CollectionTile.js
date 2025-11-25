import React, { useEffect, useState, useMemo, useRef, useEffectEvent } from 'react';
import { MdCenterFocusWeak } from 'react-icons/md';
import { FaTrash, FaPlay } from 'react-icons/fa';

import ContextMenu from './ContextMenu';
import { createCollectionMenuItems } from './utils/contextMenuItems';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { highlightedCollectionUidState, deletingCollectionUidsState, draggingTabState } from './atoms/animationsState';
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
        _handleOpenTabs();
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

    return (
        <DroppableCollection collection={props.collection}>
            <div
                className={`collection-tile ${props.activeId === props.collection.uid ? 'dragging' : ''} ${isAutoUpdate ? 'active-auto-tracking' : ''} ${isHighlighted ? 'new-tile-highlight' : ''} ${isDeleting ? 'new-tile-deleting' : ''} ${props.lightningEffect ? 'lightning-effect' : ''}`}
                style={{
                    ...(props.collection.color && props.collection.color !== 'default' && props.collection.color !== 'var(--setting-row-border-color)' && { borderColor: getColorValue(props.collection.color) })
                }}
                onClick={_handleTileClick}
                {...props.dragAttributes}
                {...props.dragListeners}
            >

            {/* Collection name */}
            <div className="tile-header">
                <div className="tile-title-row">
                    <h3 className="tile-title" title={collectionName}>
                        {collectionName}
                    </h3>
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

            {/* Footer */}
            <div className="tile-footer">
                <div className="tile-stats">
                    {tabCount} tabs and {groupCount} groups
                </div>
                <div className="tile-time">
                    {formatTimeAgo(props.collection.lastUpdated || props.collection.createdOn)}
                </div>
            </div>

            {/* Action buttons */}
            <div 
                className="tile-actions" 
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button
                    className="tile-action-button play-button"
                    onClick={(e) => { e.stopPropagation(); _handleOpenTabs(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    data-tooltip-id="main-tooltip" data-tooltip-content={isAutoUpdate ? "Focus collection window" : "Open collection tabs"}
                    data-tooltip-class-name="small-tooltip"
                >
                    {isAutoUpdate ? <MdCenterFocusWeak /> : <FaPlay />}
                </button>

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
                />

                <button
                    className="tile-action-button delete-button"
                    onClick={(e) => { e.stopPropagation(); _handleDelete(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    data-tooltip-id="main-tooltip" data-tooltip-content="Delete collection"
                    data-tooltip-class-name="small-tooltip"
                >
                    <FaTrash />
                </button>
            </div>

            {/* Color picker */}
            <div 
                className="tile-color-picker" 
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <ColorPicker 
                    currentColor={props.collection.color}
                    action={(newColor) => {
                        const updatedCollection = { ...props.collection, color: newColor, lastUpdated: Date.now() };
                        props.updateCollection(updatedCollection, true); // Manual color change - trigger lightning effect
                    }}
                    tooltip="Change collection color"
                />
            </div>
        </div>
        </DroppableCollection>
    );
}

export default CollectionTile;