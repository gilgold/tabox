import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdClose, MdSearch } from 'react-icons/md';
import { useAtomValue } from 'jotai';
import { settingsDataState } from './atoms/globalAppSettingsState';
import { getColorValue } from './utils/colorMigration';
import { FALLBACK_FAVICON } from './utils/sharedConstants';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import './MoveToCollectionModal.css';

function MoveToCollectionModal({
    isOpen,
    onClose,
    tab,
    sourceCollection,
    updateCollection,
    onTabMoved
}) {
    const [searchTerm, setSearchTerm] = useState('');
    const searchInputRef = useRef(null);
    const settingsData = useAtomValue(settingsDataState);

    // Focus search input when modal opens
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Get all collections except the source collection
    // Flatten folders to get collections inside them too
    const availableCollections = useMemo(() => {
        if (!settingsData) return [];
        
        const collections = [];
        
        const processItems = (items) => {
            for (const item of items) {
                if (item.isFolder) {
                    // Process collections inside folders
                    if (item.collections) {
                        for (const col of item.collections) {
                            if (col.uid !== sourceCollection?.uid) {
                                collections.push({ ...col, folderName: item.name });
                            }
                        }
                    }
                } else if (item.uid !== sourceCollection?.uid) {
                    collections.push(item);
                }
            }
        };
        
        processItems(settingsData);
        return collections;
    }, [settingsData, sourceCollection?.uid]);

    // Filter collections by search term
    const filteredCollections = useMemo(() => {
        if (!searchTerm.trim()) return availableCollections;
        
        const term = searchTerm.toLowerCase();
        return availableCollections.filter(col => 
            col.name?.toLowerCase().includes(term)
        );
    }, [availableCollections, searchTerm]);

    const handleMoveTab = async (targetCollection) => {
        try {
            // Remove tab from source collection
            const updatedSourceTabs = sourceCollection.tabs.filter(t => t.uid !== tab.uid);
            let updatedSourceGroups = [...(sourceCollection.chromeGroups || [])];
            
            // If tab was in a group and it's the last tab, remove the group
            if (tab.groupUid) {
                const remainingTabsInGroup = updatedSourceTabs.filter(t => t.groupUid === tab.groupUid).length;
                if (remainingTabsInGroup === 0) {
                    updatedSourceGroups = updatedSourceGroups.filter(g => g.uid !== tab.groupUid);
                }
            }
            
            const updatedSourceCollection = {
                ...sourceCollection,
                tabs: updatedSourceTabs,
                chromeGroups: updatedSourceGroups,
                lastUpdated: Date.now()
            };
            
            // Add tab to target collection (remove group association)
            const tabToMove = { ...tab };
            delete tabToMove.groupId;
            delete tabToMove.groupUid;
            
            const updatedTargetCollection = {
                ...targetCollection,
                tabs: [...(targetCollection.tabs || []), tabToMove],
                lastUpdated: Date.now()
            };
            
            // Update both collections
            await updateCollection(updatedSourceCollection, false);
            await updateCollection(updatedTargetCollection, true);
            
            showSuccessToast(`Moved tab to "${targetCollection.name}"`);
            
            if (onTabMoved) {
                onTabMoved(tab, targetCollection);
            }
            
            onClose();
        } catch (error) {
            console.error('Error moving tab:', error);
            showErrorToast('Failed to move tab');
        }
    };

    if (!isOpen) return null;

    const modalContent = (
        <div className="move-modal-overlay" onClick={onClose}>
            <div className="move-modal" onClick={(e) => e.stopPropagation()}>
                <div className="move-modal-header">
                    <h3>Move tab to...</h3>
                    <button className="move-modal-close" onClick={onClose}>
                        <MdClose size={20} />
                    </button>
                </div>
                
                <div className="move-modal-search">
                    <MdSearch size={18} className="search-icon" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search collections..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                
                <div className="move-modal-tab-info">
                    <img 
                        src={tab.favIconUrl || FALLBACK_FAVICON}
                        alt=""
                        className="tab-favicon"
                        onError={(e) => { e.target.src = FALLBACK_FAVICON; }}
                    />
                    <span className="tab-title">{tab.title}</span>
                </div>
                
                <div className="move-modal-list">
                    {filteredCollections.length === 0 ? (
                        <div className="move-modal-empty">
                            {searchTerm ? 'No collections match your search' : 'No other collections available'}
                        </div>
                    ) : (
                        filteredCollections.map((col) => (
                            <button
                                key={col.uid}
                                className="move-modal-item"
                                onClick={() => handleMoveTab(col)}
                            >
                                <div 
                                    className="collection-color-dot"
                                    style={{ 
                                        backgroundColor: col.color && col.color !== 'default' 
                                            ? getColorValue(col.color) 
                                            : 'var(--primary-color)' 
                                    }}
                                />
                                <div className="collection-info">
                                    <span className="collection-name">{col.name}</span>
                                    <span className="collection-meta">
                                        {col.tabs?.length || 0} tabs
                                        {col.folderName && ` • in ${col.folderName}`}
                                    </span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}

export default MoveToCollectionModal;
