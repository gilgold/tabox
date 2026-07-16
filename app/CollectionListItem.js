import React, { useEffect, useState, useRef, useMemo, useEffectEvent } from 'react';
import { MdDragIndicator, MdCenterFocusWeak, MdChevronRight } from 'react-icons/md';
import { FaPlay, FaStar, FaRegStar } from 'react-icons/fa';
import { BsIncognito } from 'react-icons/bs';
import ContextMenu from './ContextMenu';
import { createCollectionMenuItems } from './utils/contextMenuItems';
import { countNonEmptyGroups } from './utils/groupCount';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { deletingCollectionUidsState, highlightedCollectionUidState, dragSessionState } from './atoms/animationsState';
import { trackingStateVersion } from './atoms/globalAppSettingsState';
import { aiProcessingUidsState, aiProcessingCurrentUidState, aiSplitTargetState, aiToolsModalOpenState, aiToolsScopeState } from './atoms/aiState';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import { isAISupported } from './ai/aiClient';
import './AIEffects.css';

import ColorPicker from './ColorPicker';
import { useCollectionOperations } from './useCollectionOperations';
import { browser } from '../static/globals';
import DroppableCollection from './DroppableCollection';

function CollectionListItem(props) {
    const deletingCollectionUids = useAtomValue(deletingCollectionUidsState);
    const setDeletingCollectionUids = useSetAtom(deletingCollectionUidsState);
    const highlightedCollectionUid = useAtomValue(highlightedCollectionUidState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const dragSession = useAtomValue(dragSessionState);
    const aiProcessingUids = useAtomValue(aiProcessingUidsState);
    const aiProcessingCurrentUid = useAtomValue(aiProcessingCurrentUidState);
    const [isAutoUpdate, setIsAutoUpdate] = useState(false);
    const [showAllMatchingTabs, setShowAllMatchingTabs] = useState(false);
    const [isInteractionActive, setIsInteractionActive] = useState(false);
    const mountedRef = useRef(true);
    const itemRef = useRef(null);
    
    // Prevent expansion when dragging a tab or group (unless it's from this collection)
    const isDraggingItem = dragSession !== null;
    const isDraggingFromThisCollection = dragSession?.sourceCollectionUid === props.collection.uid;



    // Check if this item should be highlighted (new UID-based system)
    const isHighlighted = highlightedCollectionUid === props.collection.uid;

    // Check if this item is being deleted
    const isDeleting = deletingCollectionUids.has(props.collection.uid);

    // AI processing state
    const isAiProcessing = aiProcessingUids.includes(props.collection.uid);
    const isAiCurrent = aiProcessingCurrentUid === props.collection.uid;

    // AI Split Collection
    const setAIToolsOpen = useSetAtom(aiToolsModalOpenState);
    const setAIToolsScope = useSetAtom(aiToolsScopeState);
    const setSplitTarget = useSetAtom(aiSplitTargetState);
    const aiEnabled = useTaboxAIEnabled() && isAISupported();
    const tabCount = props.collection.tabs?.length ?? props.collection.tabCount ?? 0;

    const _handleSplitCollection = () => {
        setAIToolsScope({ type: 'selected', uids: [props.collection.uid] });
        setSplitTarget({ uid: props.collection.uid });
        setAIToolsOpen(true);
    };

    // Use shared collection operations
    const {
        _handleDelete,
        _handleDuplicate,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleFocusWindow,
        _handleStopTracking,
        _handleToggleFavorite
    } = useCollectionOperations({
        collection: props.collection,
        removeCollection: props.removeCollection,
        updateCollection: props.updateCollection,
        updateRemoteData: props.updateRemoteData,
        setIsAutoUpdate,
        index: props.index,
        setDeletingCollectionUids,
        addCollection: props.addCollection,
        onDataUpdate: props.onDataUpdate,
        folders: props.folders
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

    // Use Effect Event for loading auto-update status
    const loadAutoUpdateStatus = useEffectEvent(async () => {
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        if (!collectionsToTrack || collectionsToTrack == {}) {
            if (mountedRef.current) {
                setIsAutoUpdate(false);
            }
            return;
        }
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(props.collection.uid);
        if (mountedRef.current) {
            setIsAutoUpdate(chkEnableAutoUpdate && collectionIsActive);
        }
    });

    // Check auto-update status on mount and when collection changes
    useEffect(() => {
        loadAutoUpdateStatus();
    }, [props.collection.uid]); // Use UID instead of full object for more stable dependency
    
    // PERFORMANCE FIX: Watch global tracking version instead of individual storage listener
    // This prevents having N storage listeners (one per collection)
    const trackingVersion = useAtomValue(trackingStateVersion);
    useEffect(() => {
                loadAutoUpdateStatus();
    }, [trackingVersion]);

    const handleSaveCollectionColor = async (color) => {
        let newCollectionItem = { ...props.collection };
        newCollectionItem.color = color;
        newCollectionItem.lastUpdated = Date.now();
        await props.updateCollection(newCollectionItem, true); // Manual color change - trigger lightning effect
    }

    // Handle row click to open detail panel
    const _handleRowClick = (e) => {
        e.stopPropagation();
        // Prevent opening panel when dragging a tab or group from another collection
        if (isDraggingItem && !isDraggingFromThisCollection) {
            return;
        }
        // Call onSelect to open the detail panel
        if (props.onSelect) {
            props.onSelect(props.collection);
        }
    };

    const totalGroups = countNonEmptyGroups(props.collection);
    const timeAgo = new TimeAgo('en-US');
    let style = isDeleting ? {} : {};

    // Check if collection was recently opened (last 3 hours)
    const isRecentlyOpened = useMemo(() => {
        if (!props.collection.lastOpened) return false;
        const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
        return props.collection.lastOpened >= threeHoursAgo;
    }, [props.collection.lastOpened]);

    // Check if collection was saved from incognito
    const wasFromIncognito = props.collection.savedFromIncognito === true;

    // Get first 5 tabs for favicon preview (with title for tooltip)
    const previewTabs = useMemo(() => {
        const tabs = props.collection.tabs || [];
        return tabs.slice(0, 5).filter(tab => tab.favIconUrl).map(tab => ({
            favIconUrl: tab.favIconUrl,
            title: tab.title || tab.url || ''
        }));
    }, [props.collection.tabs]);

    // Helper function to escape regex special characters
    const escapeRegex = (string) => {
        return string.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    };

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

    // Get the actual matching tabs for inline preview
    const matchingTabs = useMemo(() => {
        if (!props.search || !props.search.trim()) return [];
        const searchRegex = new RegExp(escapeRegex(props.search), 'i');
        return (props.collection.tabs || []).filter(tab =>
            tab.title?.match(searchRegex) || tab.url?.match(searchRegex)
        );
    }, [props.search, props.collection.tabs]);

    // Reset expanded state when search term changes
    useEffect(() => {
        setShowAllMatchingTabs(false);
    }, [props.search]);

    // Helper function to highlight matching text in any string
    const highlightText = (text, search) => {
        if (!text || !search?.trim()) return null;
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        if (!text.match(searchRegex)) return null;
        const parts = text.split(new RegExp(`(${escapeRegex(search)})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === search.trim().toLowerCase()
                ? <span key={i} className="search-match-text">{part}</span>
                : part || null
        ).filter(Boolean);
    };

    // Note: Auto-expand for search removed - now handled by the detail panel

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
                ref={itemRef}
                onClick={_handleRowClick}
                className={[
                    'row',
                    'setting_row',
                    'collection-list-item',
                    isAutoUpdate ? 'active-auto-tracking' : '',
                    isHighlighted ? 'collection-item-highlight' : '',
                    isDeleting ? 'collection-item-deleting' : '',
                    props.lightningEffect ? 'lightning-effect' : '',
                    matchingTabs.length > 0 ? 'has-matching-tabs' : '',
                    isInteractionActive ? 'collection-item-interaction-active' : '',
                ].filter(Boolean).join(' ')}
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
                
                <div className="collection-color-picker" onClick={(e) => e.stopPropagation()}>
                    <ColorPicker
                        currentColor={props.collection.color}
                        tooltip="Change collection color"
                        action={handleSaveCollectionColor}
                        onOpenChange={setIsInteractionActive}
                    />
                </div>
            
            <div
                className="column settings_div collection-info-column"
                title={props.collection.name}
            >
                <div className="collection-name-wrapper">
                    <div className="collection-name">
                        <div className="collection-name-row">
                            <span className="truncate_box">
                                {highlightMatchInName !== null ? highlightMatchInName : props.collection.name}
                            </span>
                            {wasFromIncognito && (
                                <span 
                                    className="incognito-indicator" 
                                    title="Saved from incognito window"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Saved from incognito window"
                                >
                                    <BsIncognito size={12} />
                                </span>
                            )}
                            {isRecentlyOpened && (
                                <span className="recently-opened-indicator" title="Recently opened (last 3 hours)"></span>
                            )}
                        </div>
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
            
            {/* Favicon preview */}
            <div className="collection-favicon-preview" onClick={(e) => e.stopPropagation()}>
                {previewTabs.slice(0, 4).map((tab, idx) => (
                    <img
                        key={idx}
                        src={tab.favIconUrl}
                        alt=""
                        className="preview-favicon"
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content={tab.title}
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                ))}
                {props.collection.tabs?.length > 4 && (
                    <span className="favicon-count">+{props.collection.tabs.length - 4}</span>
                )}
            </div>
            
            <div className="column right_items">
                <button
                    className={`favorite-toggle ${props.collection.isFavorite ? 'is-favorite' : ''}`}
                    aria-label={props.collection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={props.collection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={async (e) => {
                        e.stopPropagation();
                        await _handleToggleFavorite();
                    }}
                >
                    {props.collection.isFavorite ? <FaStar size={12} /> : <FaRegStar size={12} />}
                </button>
                <button
                    className={`open-tabs-icon ${isAutoUpdate ? 'focus-mode' : ''}`}
                    data-tooltip-id="main-tooltip" data-tooltip-content={isAutoUpdate ? "Focus collection window" : "Open collection tabs"}
                    onClick={async (e) => {
                        e.stopPropagation();
                        if (isAutoUpdate) {
                            await _handleFocusWindow();
                        } else {
                            await _handleOpenTabs();
                        }
                    }}
                >
                    {isAutoUpdate ? <MdCenterFocusWeak size={12} /> : <FaPlay size={8} />}
                    <span>{isAutoUpdate ? 'Focus' : 'Open'}</span>
                </button>

                <ContextMenu
                    menuItems={createCollectionMenuItems({
                        isAutoUpdate,
                        onExport: _exportCollectionToFile,
                        onDelete: _handleDelete,
                        onUpdate: _handleUpdate,
                        onStopTracking: _handleStopTracking,
                        onDuplicate: _handleDuplicate,
                        isFavorite: props.collection.isFavorite === true,
                        onToggleFavorite: _handleToggleFavorite,
                        aiEnabled,
                        tabCount,
                        onSplitCollection: _handleSplitCollection,
                    })}
                    tooltip="Collection options"
                    onOpenChange={setIsInteractionActive}
                    triggerRef={itemRef}
                />
                
                {/* Chevron indicator for panel */}
                <div className="collection-chevron">
                    <MdChevronRight size={18} />
                </div>
            </div>
            </div>
            {matchingTabs.length > 0 && (
                <div className="matching-tabs-section" onClick={(e) => e.stopPropagation()}>
                    {(showAllMatchingTabs ? matchingTabs : matchingTabs.slice(0, 3)).map((tab, idx) => (
                        <a
                            key={tab.uid || idx}
                            className="matching-tab-preview"
                            href={tab.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={tab.url}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                browser.tabs.create({ url: tab.url, active: true });
                            }}
                        >
                            {tab.favIconUrl && (
                                <img
                                    src={tab.favIconUrl}
                                    alt=""
                                    className="matching-tab-favicon"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            )}
                            <span className="matching-tab-title">
                                {highlightText(tab.title, props.search) || tab.title}
                            </span>
                            <span className="matching-tab-url">
                                {highlightText(tab.url, props.search) || tab.url}
                            </span>
                        </a>
                    ))}
                    {matchingTabs.length > 3 && (
                        <div
                            className="matching-tabs-more"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowAllMatchingTabs(!showAllMatchingTabs);
                            }}
                        >
                            {showAllMatchingTabs
                                ? 'Show less'
                                : `+ ${matchingTabs.length - 3} more matching tab${matchingTabs.length - 3 !== 1 ? 's' : ''}...`
                            }
                        </div>
                    )}
                </div>
            )}
            {isAiProcessing && (
                <div className={`ai-processing-overlay${isAiCurrent ? ' ai-processing-overlay--current' : ''}`} aria-hidden="true" />
            )}
        </div>
        </DroppableCollection>);
}

export default CollectionListItem;
