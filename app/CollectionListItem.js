import React, { useEffect, useState, useRef, useMemo } from 'react';
import { MdDragIndicator, MdCenterFocusWeak } from 'react-icons/md';
import { FaPlay } from 'react-icons/fa';
import ContextMenu from './ContextMenu';
import { createCollectionMenuItems } from './utils/contextMenuItems';
import TimeAgo from 'javascript-time-ago';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { deletingCollectionUidsState, highlightedCollectionUidState, draggingTabState, draggingGroupState } from './atoms/animationsState';

import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { getBorderColor } from './utils/colorUtils';
import ExpandedCollectionData from './ExpandedCollectionData';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import ColorPicker from './ColorPicker';
import { useCollectionOperations } from './useCollectionOperations';
import { browser } from '../static/globals';
import DroppableCollection from './DroppableCollection';

function CollectionListItem(props) {
    const deletingCollectionUids = useRecoilValue(deletingCollectionUidsState);
    const setDeletingCollectionUids = useSetRecoilState(deletingCollectionUidsState);
    const highlightedCollectionUid = useRecoilValue(highlightedCollectionUidState);
    const setHighlightedCollectionUid = useSetRecoilState(highlightedCollectionUidState);
    const draggingTab = useRecoilValue(draggingTabState);
    const draggingGroup = useRecoilValue(draggingGroupState);
    const [collectionName, setCollectionName] = useState(props.collection.name);
    const [isExpanded, setExpanded] = useState(false);
    const [isAutoUpdate, setIsAutoUpdate] = useState(false);
    const mountedRef = useRef(true);
    
    // Prevent expansion when dragging a tab or group (unless it's from this collection)
    const isDraggingTab = draggingTab !== null;
    const isDraggingGroup = draggingGroup !== null;
    const isDraggingItem = isDraggingTab || isDraggingGroup;
    const isDraggingTabFromThisCollection = draggingTab?.sourceCollection?.uid === props.collection.uid;
    const isDraggingGroupFromThisCollection = draggingGroup?.sourceCollection?.uid === props.collection.uid;
    const isDraggingFromThisCollection = isDraggingTabFromThisCollection || isDraggingGroupFromThisCollection;


    const [openSnackbar] = useSnackbar({ style: collectionName === '' ? SnackbarStyle.ERROR : SnackbarStyle.SUCCESS });

    // Check if this item should be highlighted (new UID-based system)
    const isHighlighted = highlightedCollectionUid === props.collection.uid;
    
    // Check if this item is being deleted
    const isDeleting = deletingCollectionUids.has(props.collection.uid);

    // Use shared collection operations
    const {
        _handleDelete,
        _handleDuplicate,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleExpand,
        _handleFocusWindow,
        _handleStopTracking
    } = useCollectionOperations({
        collection: props.collection,
        removeCollection: props.removeCollection,
        updateCollection: props.updateCollection,
        updateRemoteData: props.updateRemoteData,
        setIsAutoUpdate,
        setExpanded,
        index: props.index,
        isExpanded,
        setDeletingCollectionUids,
        addCollection: props.addCollection,
        onDataUpdate: props.onDataUpdate
    });

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (isHighlighted) {
            // Clear highlight after animation completes
            const timer = setTimeout(() => {
                setHighlightedCollectionUid(null);
            }, 700); // Highlight animation duration (was 1200ms, now 700ms)
            
            return () => clearTimeout(timer);
        }
    }, [isHighlighted, setHighlightedCollectionUid]);

    useEffect(async () => {
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        if (!collectionsToTrack || collectionsToTrack == {}) return;
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(props.collection.uid);
        if (mountedRef.current) {
            setIsAutoUpdate(chkEnableAutoUpdate && collectionIsActive);
        }
    }, [props.collection]);

    const handleSaveCollectionColor = async (color) => {
        let newCollectionItem = { ...props.collection };
        newCollectionItem.color = color;
        newCollectionItem.lastUpdated = Date.now();
        await props.updateCollection(newCollectionItem, true); // Manual color change - trigger lightning effect
    }

    // All collection operations are now handled by the shared hook

    const _handleExpandWithNameReset = () => {
        _handleExpand();
        setCollectionName(props.collection.name);
    };

    const handleCollectionNameChange = (val) => {
        setCollectionName(val.trim());
        if (val.trim() === "") {
            openSnackbar("Please enter a name for the collection", 4000);
            setCollectionName(props.collection.name);
            return;
        }
        let currentCollection = { ...props.collection };
        currentCollection.name = val;
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true); // Manual name change - trigger lightning effect
        openSnackbar(`Collection name updated to '${val}'!`, 5000);
    }

    const _handleRowClick = (e) => {
        e.stopPropagation();
        // Prevent expansion when dragging a tab or group from another collection
        if (isDraggingItem && !isDraggingFromThisCollection) {
            return;
        }
        _handleExpandWithNameReset();
    };

    const totalGroups = props.collection.chromeGroups ? props.collection.chromeGroups.length : 0;
    const timeAgo = new TimeAgo('en-US');
    let style = isDeleting ? {} : {};

    // Check if collection was recently opened (last 3 hours)
    const isRecentlyOpened = useMemo(() => {
        if (!props.collection.lastOpened) return false;
        const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
        return props.collection.lastOpened >= threeHoursAgo;
    }, [props.collection.lastOpened]);

    // Helper function to escape regex special characters
    const escapeRegex = (string) => {
        return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    };

    // Check if collection name matches search (but not tabs)
    const hasMatchingName = useMemo(() => {
        if (!props.search || !props.search.trim()) return false;
        const searchRegex = new RegExp(escapeRegex(props.search), 'i');
        return props.collection.name?.match(searchRegex) || false;
    }, [props.search, props.collection.name]);

    // Check if collection has matching tabs when search is active
    const hasMatchingTabs = useMemo(() => {
        if (!props.search || !props.search.trim()) return false;
        const searchRegex = new RegExp(escapeRegex(props.search), 'i');
        return props.collection.tabs && props.collection.tabs.some(tab => 
            tab.title?.match(searchRegex) || 
            tab.url?.match(searchRegex)
        );
    }, [props.search, props.collection.tabs]);

    // Count matching tabs when search is active
    const matchingTabsCount = useMemo(() => {
        if (!props.search || !props.search.trim()) return 0;
        const searchRegex = new RegExp(escapeRegex(props.search), 'i');
        return props.collection.tabs ? props.collection.tabs.filter(tab => 
            tab.title?.match(searchRegex) || 
            tab.url?.match(searchRegex)
        ).length : 0;
    }, [props.search, props.collection.tabs]);

    // Auto-expand collections ONLY when tabs match (not when only name matches)
    useEffect(() => {
        if (props.search && props.search.trim()) {
            if (hasMatchingTabs) {
                // Auto-expand if search is active and has matching tabs
                setExpanded(true);
            } else {
                // If no tabs match (even if name matches), ensure collection is collapsed
                // This handles the case where only collection name matches the search
                setExpanded(false);
            }
        }
        // Note: We don't auto-collapse when search is cleared to preserve user's manual expansion state
    }, [props.search, hasMatchingTabs]);

    // Helper function to highlight matching text in collection name
    const highlightMatchInName = useMemo(() => {
        if (!props.search || !props.search.trim()) {
            return null;
        }
        
        const name = props.collection.name;
        const searchTerm = props.search.trim();
        
        // Check if name matches search (case-insensitive)
        const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
        if (!name || !name.match(searchRegex)) {
            return null;
        }
        
        const escapedSearch = escapeRegex(searchTerm);
        const highlightRegex = new RegExp(`(${escapedSearch})`, 'gi');
        const parts = name.split(highlightRegex);
        
        return parts.map((part, index) => {
            // Check if this part matches the search term (case-insensitive)
            if (part.toLowerCase() === searchTerm.toLowerCase()) {
                return (
                    <span key={`match-${index}-${part}`} className="search-match-text">
                        {part}
                    </span>
                );
            }
            return part ? <span key={`text-${index}-${part}`}>{part}</span> : null;
        }).filter(Boolean);
    }, [props.search, props.collection.name]);

    return (
        <DroppableCollection collection={props.collection}>
            <div 
                onClick={_handleRowClick} 
                className={`row setting_row collection-list-item ${isExpanded ? 'expanded' : ''} ${isAutoUpdate && 'active-auto-tracking'} ${isHighlighted ? 'collection-item-highlight' : ''} ${isDeleting ? 'collection-item-deleting' : ''} ${props.lightningEffect ? 'lightning-effect' : ''}`} 
                style={{ 
                    ...style, 
                    border: '2px solid var(--setting-row-border-color)'
                }}
                data-in-folder={props.isInFolder ? 'true' : 'false'}
            >
            <div className="collection-row-main">
                <div
                    className="column handle"
                    {...props.dragHandleProps.attributes}
                    {...props.dragHandleProps.listeners}
                >
                    <MdDragIndicator />
                </div>
            <div className="column color-picker-column">
                <div style={{ position: 'relative', display: 'flex' }}>
                    <ColorPicker
                        currentColor={props.collection.color}
                        tooltip="Choose a color for this collection"
                        action={handleSaveCollectionColor} />
                </div>
            </div>
            <div
                className="column settings_div"
                title={props.collection.name}
            >
                <div className="collection-name-wrapper">
                    <div className="collection-name">
                        {isExpanded ?
                            <div className="edit-collection-wrapper" onClick={(e) => e.stopPropagation()}>
                                <AutoSaveTextbox
                                    onChange={setCollectionName}
                                    maxLength={50}
                                    initValue={props.collection.name}
                                    item={props.collection}
                                    action={handleCollectionNameChange} />
                            </div>
                            :
                            <div className="collection-name-row">
                                <span className="truncate_box">
                                    {highlightMatchInName !== null ? highlightMatchInName : props.collection.name}
                                </span>
                                {isRecentlyOpened && (
                                    <span className="recently-opened-indicator" title="Recently opened (last 3 hours)"></span>
                                )}
                            </div>
                        }
                    </div>
                    <div className="collection-counts">
                        {props.search && props.search.trim() && hasMatchingTabs ? (
                            <>
                                <span className="matching-tabs-indicator">
                                    {matchingTabsCount} matching tab{matchingTabsCount !== 1 ? 's' : ''}
                                </span>
                                <span className="collection-separator"> • </span>
                            </>
                        ) : null}
                        <span className="collection-time-ago">
                            {props.collection.lastUpdated ? timeAgo.format(new Date(props.collection.lastUpdated)) :
                                props.collection.createdOn ? timeAgo.format(new Date(props.collection.createdOn)) : 'Unknown time'}
                        </span>
                        <span className="collection-separator"> • </span>
                        <span>
                            {props.collection.tabs?.length || 0} tab{(props.collection.tabs?.length || 0) > 1 ? 's' : ''} {totalGroups > 0 && '(' + totalGroups + ' group' + (totalGroups > 1 ? 's' : '') + ')'}
                        </span>
                    </div>
                </div>
            </div>
            <div className="column right_items">
                <button
                    className="open-tabs-icon"
                    data-tip={isAutoUpdate ? "Focus collection window" : "Open collection tabs"}
                    onClick={async (e) => {
                        e.stopPropagation();
                        if (isAutoUpdate) {
                            await _handleFocusWindow();
                        } else {
                            await _handleOpenTabs();
                        }
                    }}
                >
                    {isAutoUpdate ? <MdCenterFocusWeak size={20} /> : <FaPlay />}
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
                </div>
            </div>
            {isExpanded ? (
                <div className="expanded-wrapper" onClick={(e) => e.stopPropagation()}>
                    <ExpandedCollectionData
                        collection={props.collection}
                        updateCollection={props.updateCollection}
                        updateRemoteData={props.updateRemoteData}
                        search={props.search} />
                </div>
            ) : null}
        </div>
        </DroppableCollection>);
}

export default CollectionListItem;