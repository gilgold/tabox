import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { MdFolder, MdFolderOpen, MdCollections } from 'react-icons/md';
import './FoldersSidebar.css';

function AllCollectionsItem({ isSelected, onClick, collectionCount }) {
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: 'all-collections-drop-zone',
        data: {
            type: 'all-collections',
        }
    });

    const style = {
        backgroundColor: isSelected ? 'var(--primary-color)' : (isOver ? 'rgba(79, 172, 254, 0.2)' : 'transparent'),
        color: isSelected ? 'white' : 'var(--text-color)',
        border: isOver ? '2px dashed var(--primary-color)' : 'none',
    };

    return (
        <div
            ref={setNodeRef}
            className={`sidebar-item all-collections-item ${isSelected ? 'selected' : ''}`}
            style={style}
            onClick={onClick}
        >
            <MdCollections size={20} />
            <span className="sidebar-item-text">All Collections</span>
            {collectionCount > 0 && (
                <span className="sidebar-item-count">{collectionCount}</span>
            )}
            {isOver && (
                <div className="drop-indicator">
                    Drop here to remove from folder
                </div>
            )}
        </div>
    );
}

function FolderSidebarItem({ folder, isSelected, onClick, collectionCount }) {
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: `sidebar-folder-${folder.uid}`,
        data: {
            type: 'folder',
            folder: folder
        }
    });

    const style = {
        backgroundColor: isSelected ? 'var(--primary-color)' : (isOver ? 'rgba(79, 172, 254, 0.2)' : 'transparent'),
        color: isSelected ? 'white' : 'var(--text-color)',
        border: isOver ? '2px dashed var(--primary-color)' : 'none',
    };

    return (
        <div
            ref={setNodeRef}
            className={`sidebar-item folder-item ${isSelected ? 'selected' : ''}`}
            style={style}
            onClick={onClick}
        >
            {folder.collapsed ? (
                <MdFolder size={20} />
            ) : (
                <MdFolderOpen size={20} />
            )}
            <span className="sidebar-item-text" title={folder.name}>
                {folder.name}
            </span>
            {collectionCount > 0 && (
                <span className="sidebar-item-count">{collectionCount}</span>
            )}
            {isOver && (
                <div className="drop-indicator">
                    Drop here to add to folder
                </div>
            )}
        </div>
    );
}

function FoldersSidebar({ folders, collections, selectedFolderId, onFolderSelect }) {
    // Calculate collection counts
    const allCollectionsCount = collections.length;
    const folderCounts = folders.reduce((acc, folder) => {
        acc[folder.uid] = collections.filter(c => c.parentId === folder.uid).length;
        return acc;
    }, {});

    return (
        <div className="folders-sidebar">
            <AllCollectionsItem
                isSelected={selectedFolderId === null}
                onClick={() => onFolderSelect(null)}
                collectionCount={allCollectionsCount}
            />
            <div className="sidebar-divider"></div>
            <div className="sidebar-folders-list">
                {folders.map(folder => (
                    <FolderSidebarItem
                        key={folder.uid}
                        folder={folder}
                        isSelected={selectedFolderId === folder.uid}
                        onClick={() => onFolderSelect(folder.uid)}
                        collectionCount={folderCounts[folder.uid] || 0}
                    />
                ))}
            </div>
        </div>
    );
}

export default FoldersSidebar;

