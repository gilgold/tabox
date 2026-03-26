import React, { useEffect, useState, useMemo, useRef, useEffectEvent } from 'react';
import { createPortal } from 'react-dom';
import { MdClose, MdCenterFocusWeak, MdEdit, MdOutlineRefresh, MdContentCopy, MdDelete, MdSearch } from 'react-icons/md';
import { FaPlay } from 'react-icons/fa';
import { FaStop } from 'react-icons/fa6';
import { BsIncognito } from 'react-icons/bs';
import { CiExport } from 'react-icons/ci';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { deletingCollectionUidsState, highlightedCollectionUidState } from './atoms/animationsState';
import { trackingStateVersion } from './atoms/globalAppSettingsState';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { useCollectionOperations } from './useCollectionOperations';
import { browser } from '../static/globals';
import ColorPicker from './ColorPicker';
import ExpandedCollectionData from './ExpandedCollectionData';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import { getColorValue } from './utils/colorMigration';
import './CollectionDetailPanel.css';

function CollectionDetailPanel({
    collection,
    isOpen,
    onClose,
    updateCollection,
    removeCollection,
    updateRemoteData,
    addCollection,
    onDataUpdate,
    index = 0,
    renderInline = false
}) {
    const [isAnimatingOut, setIsAnimatingOut] = useState(false);
    const [collectionName, setCollectionName] = useState(collection?.name || '');
    const [isAutoUpdate, setIsAutoUpdate] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [localColor, setLocalColor] = useState(collection?.color || 'default');
    const [tabSearch, setTabSearch] = useState('');
    const mountedRef = useRef(true);
    const panelRef = useRef(null);
    const searchInputRef = useRef(null);

    const deletingCollectionUids = useAtomValue(deletingCollectionUidsState);
    const setDeletingCollectionUids = useSetAtom(deletingCollectionUidsState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);

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
        collection,
        removeCollection,
        updateCollection,
        updateRemoteData,
        setIsAutoUpdate,
        index,
        setDeletingCollectionUids,
        addCollection,
        onDataUpdate
    });

    // Sync local state when collection changes
    useEffect(() => {
        if (collection?.name) {
            setCollectionName(collection.name);
        }
        setLocalColor(collection?.color || 'default');
        setTabSearch('');
    }, [collection?.uid]);

    // Keep local color in sync when the prop updates (e.g. from external changes)
    useEffect(() => {
        if (collection?.color !== undefined) {
            setLocalColor(collection.color || 'default');
        }
    }, [collection?.color]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Use Effect Event for loading auto-update status
    const loadAutoUpdateStatus = useEffectEvent(async () => {
        if (!collection?.uid) return;
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        if (!collectionsToTrack || collectionsToTrack == {}) {
            if (mountedRef.current) {
                setIsAutoUpdate(false);
            }
            return;
        }
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(collection.uid);
        if (mountedRef.current) {
            setIsAutoUpdate(chkEnableAutoUpdate && collectionIsActive);
        }
    });

    // Check auto-update status on mount and when collection changes
    useEffect(() => {
        loadAutoUpdateStatus();
    }, [collection?.uid]);

    // Watch global tracking version
    const trackingVersion = useAtomValue(trackingStateVersion);
    useEffect(() => {
        loadAutoUpdateStatus();
    }, [trackingVersion]);

    // Handle escape key to close panel
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Handle click outside to close (only if not clicking on a collection or dragging)
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (isOpen && panelRef.current && !panelRef.current.contains(e.target)) {
                const isCollectionClick = e.target.closest('[data-collection-drop-zone]') || 
                                         e.target.closest('.setting_row') ||
                                         e.target.closest('.collection-tile');
                const isPopoverClick = e.target.closest('.modern-color-popover');
                if (!isCollectionClick && !isPopoverClick) {
                    handleClose();
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleClose = () => {
        setIsAnimatingOut(true);
        setIsEditingName(false);
        setTabSearch('');
        setTimeout(() => {
            setIsAnimatingOut(false);
            onClose();
        }, 300);
    };

    const handleSaveCollectionColor = async (color) => {
        if (!collection) return;
        setLocalColor(color || 'default');
        let newCollectionItem = { ...collection };
        newCollectionItem.color = color;
        newCollectionItem.lastUpdated = Date.now();
        await updateCollection(newCollectionItem, true);
    };

    const handleCollectionNameChange = (val) => {
        setCollectionName(val.trim());
        if (val.trim() === "") {
            showErrorToast("Please enter a name for the collection");
            setCollectionName(collection.name);
            return;
        }
        let currentCollection = { ...collection };
        currentCollection.name = val;
        currentCollection.lastUpdated = Date.now();
        updateCollection(currentCollection, true);
        showSuccessToast(`Collection name updated to '${val}'!`);
        setIsEditingName(false);
    };

    const handleDeleteAndClose = async () => {
        await _handleDelete();
        handleClose();
    };

    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    
    if (!collection) return null;

    const tabCount = collection.tabs?.length || 0;
    const groupCount = collection.chromeGroups?.length || 0;
    const wasFromIncognito = collection.savedFromIncognito === true;

    const formatTimeAgo = (timestamp) => {
        try {
            return timeAgo.format(new Date(timestamp));
        } catch (error) {
            return 'Recently';
        }
    };

    // Check if collection was recently opened (last 3 hours)
    const isRecentlyOpened = useMemo(() => {
        if (!collection.lastOpened) return false;
        const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
        return collection.lastOpened >= threeHoursAgo;
    }, [collection.lastOpened]);

    const panelContent = (
        <div className={`panel-overlay ${isOpen && !isAnimatingOut ? 'visible' : ''}`}>
            <div 
                ref={panelRef}
                className={`collection-detail-panel ${isOpen && !isAnimatingOut ? 'open' : ''} ${isAnimatingOut ? 'closing' : ''}`}
            >
                {/* Panel Header */}
                <div className="panel-header">
                    <button
                        className="panel-close-btn"
                        onClick={handleClose}
                    >
                        <MdClose size={16} />
                        <span>Close</span>
                    </button>
                </div>

                {/* Collection Info Section */}
                <div className="panel-collection-info">
                    {/* Color indicator bar */}
                    <div 
                        className="panel-color-bar"
                        style={{ 
                            backgroundColor: localColor && localColor !== 'default' 
                                ? getColorValue(localColor) 
                                : 'var(--primary-color)' 
                        }}
                    />

                    {/* Title and metadata */}
                    <div className="panel-title-section">
                        <div className="panel-title-row">
                            {isEditingName ? (
                                <div className="panel-title-edit">
                                    <AutoSaveTextbox
                                        onChange={setCollectionName}
                                        maxLength={50}
                                        initValue={collection.name}
                                        item={collection}
                                        action={handleCollectionNameChange}
                                        autoFocus
                                    />
                                </div>
                            ) : (
                                <>
                                    <h2 className="panel-title">{collectionName}</h2>
                                    <button 
                                        className="panel-edit-btn"
                                        onClick={() => setIsEditingName(true)}
                                        data-tooltip-id="main-tooltip"
                                        data-tooltip-content="Edit collection name"
                                    >
                                        <MdEdit size={16} />
                                    </button>
                                </>
                            )}
                            {wasFromIncognito && (
                                <span 
                                    className="panel-incognito-badge"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Saved from incognito window"
                                >
                                    <BsIncognito size={14} />
                                </span>
                            )}
                            {isRecentlyOpened && (
                                <span 
                                    className="panel-recent-badge"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Recently opened (last 3 hours)"
                                >
                                    Recent
                                </span>
                            )}
                        </div>

                        <div className="panel-meta">
                            <span className="panel-meta-item">
                                {tabCount} tab{tabCount !== 1 ? 's' : ''}
                            </span>
                            {groupCount > 0 && (
                                <>
                                    <span className="panel-meta-separator">•</span>
                                    <span className="panel-meta-item">
                                        {groupCount} group{groupCount !== 1 ? 's' : ''}
                                    </span>
                                </>
                            )}
                            <span className="panel-meta-separator">•</span>
                            <span className="panel-meta-item">
                                {formatTimeAgo(collection.lastUpdated || collection.createdOn)}
                            </span>
                        </div>

                    </div>

                    {/* Quick Actions */}
                    <div className="panel-actions">
                        <div className="panel-action-group">
                            <ColorPicker
                                currentColor={localColor}
                                tooltip="Change collection color"
                                action={handleSaveCollectionColor}
                            />
                            
                            <button
                                className="panel-action-btn secondary"
                                onClick={_handleUpdate}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Update with current window tabs"
                            >
                                <MdOutlineRefresh size={16} />
                            </button>

                            <button
                                className="panel-action-btn secondary"
                                onClick={_handleDuplicate}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Duplicate collection"
                            >
                                <MdContentCopy size={16} />
                            </button>

                            <button
                                className="panel-action-btn secondary"
                                onClick={_exportCollectionToFile}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Export collection"
                            >
                                <CiExport size={16} />
                            </button>

                            {isAutoUpdate && (
                                <button
                                    className="panel-action-btn stop-tracking"
                                    onClick={_handleStopTracking}
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Stop auto-tracking this collection"
                                >
                                    <FaStop size={12} />
                                </button>
                            )}

                            <button
                                className="panel-action-btn danger"
                                onClick={handleDeleteAndClose}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Delete collection"
                            >
                                <MdDelete size={16} />
                            </button>

                            <button
                                className="panel-action-btn primary flex-grow"
                                onClick={isAutoUpdate ? _handleFocusWindow : _handleOpenTabs}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content={isAutoUpdate ? "Focus collection window" : "Open all tabs in new window"}
                            >
                                {isAutoUpdate ? <MdCenterFocusWeak size={16} /> : <FaPlay size={12} />}
                                <span>{isAutoUpdate ? 'Focus Window' : 'Open Tabs'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tab Search */}
                {tabCount > 0 && (
                    <div className="panel-search-bar">
                        <MdSearch size={16} className="panel-search-icon" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="panel-search-input"
                            placeholder={`Search ${tabCount} tab${tabCount !== 1 ? 's' : ''}...`}
                            value={tabSearch}
                            onChange={(e) => setTabSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    if (tabSearch) {
                                        e.stopPropagation();
                                        setTabSearch('');
                                    }
                                }
                            }}
                        />
                        {tabSearch && (
                            <button
                                className="panel-search-clear"
                                onClick={() => { setTabSearch(''); searchInputRef.current?.focus(); }}
                            >
                                <MdClose size={14} />
                            </button>
                        )}
                    </div>
                )}

                {/* Tabs Content */}
                <div className="panel-content">
                    <ExpandedCollectionData
                        collection={collection}
                        updateCollection={updateCollection}
                        updateRemoteData={updateRemoteData}
                        search={tabSearch}
                    />
                </div>
            </div>
        </div>
    );

    // In fullpage mode, render inline (no portal needed)
    if (renderInline) {
        return panelContent;
    }

    // In popup mode, render in portal to avoid z-index issues
    return createPortal(panelContent, document.body);
}

export default CollectionDetailPanel;
