import React, { useEffect, useState, useMemo, useRef, useEffectEvent } from 'react';
import { createPortal } from 'react-dom';
import { MdClose, MdCenterFocusWeak, MdEdit, MdOutlineRefresh, MdContentCopy, MdDelete, MdSearch } from 'react-icons/md';
import { FaPlay } from 'react-icons/fa';
import { FaStop } from 'react-icons/fa6';
import { BsIncognito, BsStars } from 'react-icons/bs';
import { CiExport } from 'react-icons/ci';
import TimeAgo from 'javascript-time-ago';
import { useSetAtom, useAtomValue } from 'jotai';
import { deletingCollectionUidsState } from './atoms/animationsState';
import { aiProcessingUidsState, aiProcessingCurrentUidState } from './atoms/aiState';
import { trackingStateVersion } from './atoms/globalAppSettingsState';
import { showSuccessToast, showErrorToast, showUndoToast } from './toastHelpers';
import { UNDO_TIME } from './constants';
import { useCollectionOperations } from './useCollectionOperations';
import { browser } from '../static/globals';
import ColorPicker from './ColorPicker';
import CollectionDeleteConfirmModal from './CollectionDeleteConfirmModal';
import ExpandedCollectionData from './ExpandedCollectionData';
import { getColorValue } from './utils/colorMigration';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import { isAISupported } from './ai/aiClient';
import { suggestCollectionName } from './ai/tasks/suggestCollectionName';
import { loadSingleCollection } from './utils/storageUtils';
import { countNonEmptyGroups } from './utils/groupCount';
import './CollectionDetailPanel.css';
import './AIEffects.css';

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
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isAiRenaming, setIsAiRenaming] = useState(false);
    const mountedRef = useRef(true);
    const panelRef = useRef(null);
    const searchInputRef = useRef(null);
    const titleInputRef = useRef(null);
    const skipTitleBlurRef = useRef(false);

    const setDeletingCollectionUids = useSetAtom(deletingCollectionUidsState);
    const setAiProcessingUids = useSetAtom(aiProcessingUidsState);
    const setAiProcessingCurrentUid = useSetAtom(aiProcessingCurrentUidState);

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

    const isAIEnabled = useTaboxAIEnabled();
    const showAiRenameBtn = isAIEnabled && isAISupported();
    // The panel instance persists across collection switches; track what's
    // displayed so an in-flight AI rename never retitles the wrong collection.
    const displayedUidRef = useRef(collection?.uid);
    displayedUidRef.current = collection?.uid;

    const handleAiRename = async () => {
        if (isAiRenaming) return;
        setIsAiRenaming(true);
        const renamedUid = collection.uid;
        // Signal AI processing to consumers (cards, etc.)
        setAiProcessingUids([renamedUid]);
        setAiProcessingCurrentUid(renamedUid);
        try {
            const newName = await suggestCollectionName(collection);
            if (!newName || newName === collection.name) {
                showSuccessToast('The current name already fits!');
                return;
            }
            const fresh = await loadSingleCollection(renamedUid);
            if (!fresh) {
                showErrorToast('This collection no longer exists.');
                return;
            }
            const oldName = fresh.name;
            // Clear processing state before applying the rename so the
            // completion lightning flash doesn't overlap the looping effect.
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
            await updateCollection({ ...fresh, name: newName, lastUpdated: Date.now() }, true);
            if (displayedUidRef.current === renamedUid) {
                setCollectionName(newName);
            }
            showUndoToast(
                <BsStars />,
                `Renamed to '${newName}'`,
                oldName,
                async () => {
                    const current = await loadSingleCollection(renamedUid);
                    if (!current || current.name !== newName) return;
                    await updateCollection({ ...current, name: oldName, lastUpdated: Date.now() }, true);
                    if (displayedUidRef.current === renamedUid) {
                        setCollectionName(oldName);
                    }
                },
                UNDO_TIME,
            );
        } catch (err) {
            console.error('AI rename failed:', err);
            showErrorToast('Could not generate a name. Please try again.');
        } finally {
            // Idempotent safety: ensure atoms are cleared regardless of which
            // branch was taken (early returns above don't reach the pre-apply clear).
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
            setIsAiRenaming(false);
        }
    };

    // Sync local state when collection changes
    useEffect(() => {
        if (collection?.name) {
            setCollectionName(collection.name);
        }
        setLocalColor(collection?.color || 'default');
        setTabSearch('');
        setIsEditingName(false);
    }, [collection?.uid]);

    useEffect(() => {
        if (isEditingName && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [isEditingName]);

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
            if (e.key === 'Escape' && isDeleteConfirmOpen) {
                setIsDeleteConfirmOpen(false);
                return;
            }

            if (e.key === 'Escape' && isOpen) {
                // A tab's context menu or move-to-collection modal handles its
                // own Escape; the panel underneath must stay open.
                if (document.querySelector('.fp-tab-ctx-menu') || document.querySelector('.move-modal-overlay')) {
                    return;
                }
                handleClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isDeleteConfirmOpen, isOpen]);

    // Handle click outside to close (only if not clicking on a collection or dragging)
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (isDeleteConfirmOpen) {
                return;
            }

            if (isOpen && panelRef.current && !panelRef.current.contains(e.target)) {
                const isCollectionClick = e.target.closest('[data-collection-drop-zone]') || 
                                         e.target.closest('.setting_row') ||
                                         e.target.closest('.collection-tile');
                const isPopoverClick = e.target.closest('.modern-color-popover');
                // The tab context menu and move-to-collection modal are portaled
                // to document.body, so they sit outside panelRef even though they
                // belong to this panel's tabs.
                const isPortaledTabUiClick = e.target.closest('.fp-tab-ctx-menu') ||
                                             e.target.closest('.move-modal-overlay');
                if (!isCollectionClick && !isPopoverClick && !isPortaledTabUiClick) {
                    handleClose();
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDeleteConfirmOpen, isOpen]);

    const handleClose = () => {
        setIsAnimatingOut(true);
        setIsEditingName(false);
        setIsDeleteConfirmOpen(false);
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

    const handleCollectionNameChange = async (val) => {
        const trimmedName = val.trim();
        if (trimmedName === "") {
            showErrorToast("Please enter a name for the collection");
            setCollectionName(collection.name);
            return;
        }
        setCollectionName(trimmedName);
        let currentCollection = { ...collection };
        currentCollection.name = trimmedName;
        currentCollection.lastUpdated = Date.now();
        await updateCollection(currentCollection, true);
        showSuccessToast(`Collection name updated to '${trimmedName}'!`);
    };

    const handleTitleBlur = async () => {
        if (skipTitleBlurRef.current) {
            skipTitleBlurRef.current = false;
            return;
        }
        if (!isEditingName) return;
        await handleCollectionNameChange(collectionName);
        setIsEditingName(false);
    };

    const handleEditButtonClick = async () => {
        if (isEditingName) {
            await handleCollectionNameChange(collectionName);
            setIsEditingName(false);
            return;
        }
        setIsEditingName(true);
    };

    const handleDeleteAndClose = async () => {
        setIsDeleteConfirmOpen(false);
        await _handleDelete();
        handleClose();
    };

    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    
    if (!collection) return null;

    const tabCount = collection.tabs?.length || 0;
    const groupCount = countNonEmptyGroups(collection);
    const wasFromIncognito = collection.savedFromIncognito === true;

    const formatTimeAgo = (timestamp) => {
        try {
            return timeAgo.format(new Date(timestamp));
        } catch {
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
                            <button
                                className={`panel-edit-btn ${isEditingName ? 'active' : ''}`}
                                onMouseDown={(e) => {
                                    if (isEditingName) {
                                        skipTitleBlurRef.current = true;
                                        e.preventDefault();
                                    }
                                }}
                                onClick={handleEditButtonClick}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content={isEditingName ? 'Stop editing collection name' : 'Edit collection name'}
                                aria-label="Edit collection name"
                            >
                                <MdEdit size={16} />
                            </button>
                            {showAiRenameBtn && !isEditingName && (
                                <button
                                    type="button"
                                    className={`panel-edit-btn panel-ai-rename-btn${isAiRenaming ? ' panel-ai-rename-btn--busy' : ''}`}
                                    onClick={handleAiRename}
                                    disabled={isAiRenaming}
                                    aria-label="Auto-name with AI"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Auto-name with AI"
                                >
                                    <BsStars size={16} />
                                </button>
                            )}
                            <div className={`panel-title-slot${isAiRenaming ? ' ai-name-processing' : ''}`}>
                                {isEditingName ? (
                                    <div className="panel-title-edit panel-title-edit-active">
                                        <div className="panel-title-autosave">
                                            <input
                                                ref={titleInputRef}
                                                type="text"
                                                className="panel-title-input"
                                                value={collectionName}
                                                maxLength={50}
                                                onChange={(e) => setCollectionName(e.target.value)}
                                                onBlur={handleTitleBlur}
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        e.currentTarget.blur();
                                                    }
                                                    if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        setCollectionName(collection.name);
                                                        setIsEditingName(false);
                                                    }
                                                }}
                                                aria-label="Collection name"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <h2 className="panel-title">{collectionName}</h2>
                                )}
                            </div>
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
                                onClick={() => setIsDeleteConfirmOpen(true)}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Delete collection"
                                aria-label="Delete collection"
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

    const contentWithModal = (
        <>
            {panelContent}
            <CollectionDeleteConfirmModal
                isOpen={isDeleteConfirmOpen}
                onClose={() => setIsDeleteConfirmOpen(false)}
                onConfirm={handleDeleteAndClose}
                collectionName={collectionName}
            />
        </>
    );

    // In fullpage mode, render inline (no portal needed)
    if (renderInline) {
        return contentWithModal;
    }

    // In popup mode, render in portal to avoid z-index issues
    return createPortal(contentWithModal, document.body);
}

export default CollectionDetailPanel;
