import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { sidebarNavigationState, sidebarCollapsedState } from '../atoms/fullpageState';
import { commandPaletteOpenState } from '../atoms/commandPaletteState';
import { searchState } from '../atoms/globalAppSettingsState';
import { draggingCollectionState } from '../atoms/animationsState';
import { noPermissionOpenState, shareFolderModalState, sharedActionConfirmState, pendingInvitesState } from '../atoms/sharedFoldersState';
import { isProState } from '../atoms/premiumState';
import { downloadTextFile } from '../utils';
import { loadAllCollections } from '../utils/storageUtils';
import { getColorValue } from '../utils/colorMigration';
import { browser } from '../../static/globals';
import { showSuccessToast, showErrorToast, showInfoToast } from '../toastHelpers';
import { useTrackedSync } from '../useTrackedSync';
import { buildFolderUrlList, getCollectionUrls, copyToClipboard } from '../utils/index';
import { reorderSidebarFolders } from './sidebarFolderReorder';
import { dndPointerSensorOptions } from '../utils/dndShared';
import { createFolderMenuItems } from '../utils/contextMenuItems';
import FPCtxMenu from './FPCtxMenu';
import { isSharedFolder } from '../utils/sharedFolderUtils';
import { respondToSharedInvite } from '../utils/sharedFolderActions';
import { getDisplayInfo } from '../utils/displayInfo';
import {
    duplicateFolder,
    deleteFolder,
    updateFolderDetails,
    stopTrackingFolderCollections,
} from '../utils/folderOperations';
import {
    MdSave,
    MdFolder,
    MdInbox,
    MdCreateNewFolder,
    MdChevronLeft,
    MdChevronRight,
    MdHistory,
    MdSearch,
    MdOpenInBrowser,
    MdStar,
    MdFolderShared,
} from 'react-icons/md';
import { HiCollection } from 'react-icons/hi';
import FPBadge from './FPBadge';
import './FPSidebar.css';

const CreateFolderModal = lazy(() => import('../CreateFolderModal'));
const FolderDeleteConfirmModal = lazy(() => import('../FolderDeleteConfirmModal'));
const SaveCollectionModal = lazy(() => import('./SaveCollectionModal'));

function SidebarCounter({ value, className = '' }) {
    return (
        <FPBadge accent="neutral" className={`fp-sidebar-counter ${className}`.trim()}>{value}</FPBadge>
    );
}

function SortableSidebarFolderItem({
    folder,
    isActive,
    color,
    count,
    dragClasses,
    disableSorting,
    onSelect,
    onContextMenu,
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: folder.uid,
        disabled: disableSorting,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            data-sidebar-folder-uid={folder.uid}
            className={`fp-sidebar-folder-row ${isDragging ? 'fp-sidebar-folder-row-sorting' : ''}`}
        >
            <button
                type="button"
                className={`fp-sidebar-folder-item ${isActive ? 'active' : ''}${dragClasses}`}
                onClick={() => onSelect(folder.uid)}
                onContextMenu={(e) => onContextMenu(e, folder)}
                {...attributes}
                {...listeners}
            >
                <MdFolder size={20} className="fp-sidebar-folder-icon" style={{ color }} />
                <span className="fp-sidebar-folder-name">{folder.name}</span>
                <SidebarCounter value={count} className="fp-sidebar-folder-count" />
            </button>
        </div>
    );
}

function FPSidebar({
    folders = [],
    collections = [],
    trackedCollectionUids,
    sessionCount = 0,
    addCollection,
    addFolder,
    onFolderOptimisticUpdate,
    onDataUpdate,
    updateFolders,
    onCollectionsRevealed,
}) {
    const [navigation, setNavigation] = useAtom(sidebarNavigationState);
    const [collapsed, setCollapsed] = useAtom(sidebarCollapsedState);
    const setSearch = useSetAtom(searchState);
    const setCommandPaletteOpen = useSetAtom(commandPaletteOpenState);
    const setNoPermissionOpen = useSetAtom(noPermissionOpenState);
    const setShareFolderModal = useSetAtom(shareFolderModalState);
    const setSharedActionConfirm = useSetAtom(sharedActionConfirmState);
    const isPro = useAtomValue(isProState);
    const runTrackedSync = useTrackedSync();
    const isMac = useMemo(() => navigator.platform?.toUpperCase().includes('MAC'), []);

    const [saveModalOpen, setSaveModalOpen] = useState(false);
    const [folderModalOpen, setFolderModalOpen] = useState(false);

    const [ctxMenu, setCtxMenu] = useState(null);
    const [editFolder, setEditFolder] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);
    const ctxMenuRef = useRef(null);

    // Cross-context collection drag state, published by FPContentArea's
    // DndContext (onDragMove) into the shared atom.
    const draggingCollection = useAtomValue(draggingCollectionState);
    const isDraggingCollection = draggingCollection !== null;
    const dragOverTargetId = draggingCollection?.overSidebarTarget ?? null;

    const [currentWindowCount, setCurrentWindowCount] = useState(0);
    useEffect(() => {
        let mounted = true;

        const loadCurrentWindowCount = async () => {
            try {
                const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
                if (mounted) {
                    setCurrentWindowCount(windows.length);
                }
            } catch {
                if (mounted) {
                    setCurrentWindowCount(0);
                }
            }
        };

        loadCurrentWindowCount();

        const handleWindowChange = () => {
            loadCurrentWindowCount();
        };

        browser.windows?.onCreated?.addListener?.(handleWindowChange);
        browser.windows?.onRemoved?.addListener?.(handleWindowChange);

        return () => {
            mounted = false;
            browser.windows?.onCreated?.removeListener?.(handleWindowChange);
            browser.windows?.onRemoved?.removeListener?.(handleWindowChange);
        };
    }, []);

    // Count collections per category
    const allCount = collections.length;
    const unorganizedCount = useMemo(() => {
        const folderUids = new Set(folders.map(f => f.uid));
        return collections.filter(c => !c.parentId || !folderUids.has(c.parentId)).length;
    }, [collections, folders]);

    const favoritesCount = useMemo(() => (
        collections.filter(c => c.isFavorite === true).length
    ), [collections]);

    // Count collections per folder
    const folderCounts = useMemo(() => {
        const counts = {};
        folders.forEach(f => { counts[f.uid] = 0; });
        collections.forEach(c => {
            if (c.parentId && counts[c.parentId] !== undefined) {
                counts[c.parentId]++;
            }
        });
        return counts;
    }, [collections, folders]);

    // Total tab count
    const totalTabs = useMemo(() => {
        return collections.reduce((sum, c) => sum + (c.tabs?.length || 0), 0);
    }, [collections]);

    // Shared folders (owned-and-shared or shared-with-me) live in their own
    // section above the regular Folders list and are not drag-sortable.
    const sharedFolders = useMemo(() => folders.filter(isSharedFolder), [folders]);
    const regularFolders = useMemo(() => folders.filter((folder) => !isSharedFolder(folder)), [folders]);
    const pendingInvites = useAtomValue(pendingInvitesState);

    const sortableFolderIds = useMemo(() => regularFolders.map((folder) => folder.uid), [regularFolders]);
    const folderSortSensors = useSensors(
        useSensor(PointerSensor, dndPointerSensorOptions),
    );

    const handleFolderCreate = async (name, color) => {
        if (addFolder) await addFolder(name, color);
    };

    const handleFolderEdit = useCallback((name, color, folderUid) => {
        if (!folderUid) return;
        const folder = folders.find(f => f.uid === folderUid);
        if (!folder) return;

        const hasChanges = name !== folder.name || color !== folder.color;
        if (!hasChanges) return;

        const previousFolderDetails = {
            name: folder.name,
            color: folder.color,
        };

        onFolderOptimisticUpdate?.(folderUid, { name, color });

        void (async () => {
            const updated = await updateFolderDetails(folderUid, { name, color });

            if (!updated) {
                onFolderOptimisticUpdate?.(folderUid, previousFolderDetails);
                showErrorToast('Failed to update folder');
                return;
            }

            showSuccessToast('Folder updated');
        })();
    }, [folders, onFolderOptimisticUpdate]);

    const handleFolderSortEnd = useCallback(async (event) => {
        if (!updateFolders) return;

        const { active, over } = event;
        const reorderedFolders = reorderSidebarFolders(folders, active?.id, over?.id);

        if (reorderedFolders === folders) {
            return;
        }

        await updateFolders(reorderedFolders);
    }, [folders, updateFolders]);

    // Close context menu on outside click or scroll
    useEffect(() => {
        if (!ctxMenu) return;
        const close = () => setCtxMenu(null);
        const handleClick = (e) => {
            if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target)) close();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('scroll', close, true);
        };
    }, [ctxMenu]);

    const handleFolderContextMenu = useCallback((e, folder) => {
        e.preventDefault();
        e.stopPropagation();

        const menuWidth = 210;
        const menuHeight = 230;
        const pad = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = e.clientX;
        let y = e.clientY - 4;
        if (x + menuWidth + pad > vw) x = vw - menuWidth - pad;
        if (y + menuHeight + pad > vh) y = vh - menuHeight - pad;
        if (x < pad) x = pad;
        if (y < pad) y = pad;

        setCtxMenu({ folder, x, y });
    }, []);

    const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

    const handleCtxEdit = useCallback(() => {
        if (!ctxMenu) return;
        setEditFolder(ctxMenu.folder);
        closeCtxMenu();
    }, [ctxMenu, closeCtxMenu]);

    const handleCtxExport = useCallback(async () => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        try {
            const allCollections = await loadAllCollections();
            const collectionsInFolder = allCollections.filter(c => c.parentId === folder.uid);
            const exportData = {
                type: 'folder',
                folder: {
                    uid: folder.uid,
                    name: folder.name,
                    color: folder.color,
                    collapsed: folder.collapsed,
                    createdAt: folder.createdAt,
                    lastUpdated: folder.lastUpdated,
                    collectionCount: collectionsInFolder.length,
                },
                collections: collectionsInFolder,
                exportedAt: new Date().toISOString(),
                version: '2.0',
            };
            downloadTextFile(JSON.stringify(exportData, null, 2), `${folder.name || 'folder'}_export`);
            showSuccessToast('Folder exported');
        } catch {
            showErrorToast('Export failed');
        }
    }, [ctxMenu, closeCtxMenu]);

    const handleCtxOpenAll = useCallback(async () => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        try {
            const { getFolderCollections } = await import('../utils/folderOperations');
            const collectionsToOpen = await getFolderCollections(folder.uid);

            if (collectionsToOpen.length === 0) {
                showErrorToast('No collections in this folder');
                return;
            }

            const openedCollections = [];
            const failedCollections = [];

            const displays = await getDisplayInfo();

            for (const collection of collectionsToOpen) {
                try {
                    let windowCreationObject = { focused: true };

                    if (collection.window) {
                        let targetBounds = {
                            top: Math.round(collection.window.top),
                            left: Math.round(collection.window.left),
                            width: Math.round(collection.window.width),
                            height: Math.round(collection.window.height),
                        };
                        const isPositionValid = displays.some(display => {
                            const d = display.bounds;
                            const intersection = {
                                top: Math.max(d.top, targetBounds.top),
                                left: Math.max(d.left, targetBounds.left),
                                bottom: Math.min(d.top + d.height, targetBounds.top + targetBounds.height),
                                right: Math.min(d.left + d.width, targetBounds.left + targetBounds.width),
                            };
                            const iw = intersection.right - intersection.left;
                            const ih = intersection.bottom - intersection.top;
                            if (iw <= 0 || ih <= 0) return false;
                            return (iw * ih) / (targetBounds.width * targetBounds.height) >= 0.5;
                        });
                        if (isPositionValid) {
                            windowCreationObject = { ...windowCreationObject, ...targetBounds };
                        } else {
                            windowCreationObject.width = targetBounds.width;
                            windowCreationObject.height = targetBounds.height;
                        }
                    }

                    const win = await browser.windows.create(windowCreationObject);
                    await browser.runtime.sendMessage({
                        type: 'openTabs',
                        collection,
                        window: win,
                    });
                    openedCollections.push({ ...collection, lastOpened: Date.now() });
                } catch {
                    failedCollections.push(collection.name);
                }
            }

            if (openedCollections.length > 0) {
                try {
                    const { batchUpdateCollections } = await import('../utils/storageUtils');
                    await batchUpdateCollections(openedCollections);
                } catch { /* silent */ }
            }

            if (failedCollections.length > 0) {
                showErrorToast(`Failed to open: ${failedCollections.join(', ')}`);
            } else {
                showSuccessToast(`Opened ${openedCollections.length} collection(s)`);
            }
        } catch {
            showErrorToast('Failed to open collections');
        }
    }, [ctxMenu, closeCtxMenu]);

    const handleCtxDuplicate = useCallback(async () => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        try {
            const result = await duplicateFolder(folder.uid);
            if (result.success) {
                showSuccessToast(`Duplicated "${folder.name}" with ${result.duplicatedCollections} collection(s)`);
                if (onDataUpdate) await onDataUpdate();
            } else {
                showErrorToast('Failed to duplicate folder');
            }
        } catch {
            showErrorToast('Failed to duplicate folder');
        }
    }, [ctxMenu, closeCtxMenu, onDataUpdate]);

    const handleCtxCopyUrls = useCallback(async () => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        try {
            const { getFolderCollections } = await import('../utils/folderOperations');
            const collections = await getFolderCollections(folder.uid);
            const totalUrls = collections.reduce((n, c) => n + getCollectionUrls(c).length, 0);
            if (totalUrls === 0) {
                showInfoToast('No URLs to copy');
                return;
            }
            await copyToClipboard(buildFolderUrlList(folder, collections));
            showSuccessToast(`${totalUrls} URL${totalUrls === 1 ? '' : 's'} copied`);
        } catch {
            showErrorToast('Failed to copy URLs');
        }
    }, [ctxMenu, closeCtxMenu]);

    const handleCtxShare = useCallback(() => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        setShareFolderModal(folder);
    }, [ctxMenu, closeCtxMenu, setShareFolderModal]);

    // Leave/Unshare confirmation hardening: opens the shared
    // SharedActionConfirmModal (rendered once by App.js) instead of firing
    // the sendMessage+toast+refresh directly on a single click — that logic
    // now lives in app/utils/sharedFolderActions.js, called by the modal's
    // Confirm button.
    const handleCtxLeaveShared = useCallback(() => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        setSharedActionConfirm({ kind: 'leave', folder });
    }, [ctxMenu, closeCtxMenu, setSharedActionConfirm]);

    const handleCtxUnshare = useCallback(() => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        setSharedActionConfirm({ kind: 'unshare', folder });
    }, [ctxMenu, closeCtxMenu, setSharedActionConfirm]);

    // Pending-invite ghost rows: Accept fires the runtime message directly
    // (with a per-invite busy state); Decline opens the shared
    // SharedActionConfirmModal via the same atom the leave/unshare flows use.
    // The ghost disappears when App.js syncs pendingInvitesState from
    // chrome.storage.onChanged; an accepted folder arrives via onDataUpdate.
    const [inviteBusyId, setInviteBusyId] = useState(null);

    const handleInviteAccept = useCallback(async (invite) => {
        setInviteBusyId(invite.folderId);
        try {
            await respondToSharedInvite(invite, true, onDataUpdate);
        } finally {
            setInviteBusyId(null);
        }
    }, [onDataUpdate]);

    const handleInviteDecline = useCallback((invite) => {
        setSharedActionConfirm({ kind: 'decline-invite', invite });
    }, [setSharedActionConfirm]);

    // Whether any collection in the right-clicked folder is auto-tracked —
    // gates the "Stop Auto Tracking Folder" menu entry.
    const ctxHasTracked = useMemo(() => {
        if (!ctxMenu || !trackedCollectionUids?.size) return false;
        return collections.some((collection) => (
            collection.parentId === ctxMenu.folder.uid && trackedCollectionUids.has(collection.uid)
        ));
    }, [ctxMenu, collections, trackedCollectionUids]);

    const handleCtxStopTracking = useCallback(async () => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        try {
            const count = await stopTrackingFolderCollections(folder.uid);
            if (count > 0) {
                showSuccessToast(`Stopped auto update for ${count} collection${count === 1 ? '' : 's'}`);
            }
        } catch {
            showErrorToast('Failed to stop auto tracking');
        }
    }, [ctxMenu, closeCtxMenu]);

    const handleCtxDelete = useCallback(async () => {
        if (!ctxMenu) return;
        const folder = ctxMenu.folder;
        closeCtxMenu();
        const count = folderCounts[folder.uid] || 0;
        if (count > 0) {
            setDeleteModal({ folder, collectionCount: count });
        } else {
            const result = await deleteFolder(folder.uid, true, false, { skipSync: true });
            if (result.success) {
                if (navigation === folder.uid) setNavigation('all');
                showSuccessToast('Folder deleted');
                if (onDataUpdate) await onDataUpdate();
                await runTrackedSync();
            } else if (result.blocked) {
                setNoPermissionOpen(true);
            } else {
                showErrorToast('Failed to delete folder');
            }
        }
    }, [ctxMenu, closeCtxMenu, folderCounts, navigation, setNavigation, onDataUpdate, runTrackedSync, setNoPermissionOpen]);

    const handleDeleteConfirm = useCallback(async (deleteCollections) => {
        if (!deleteModal) return;
        const { folder } = deleteModal;
        setDeleteModal(null);
        const result = await deleteFolder(folder.uid, true, deleteCollections, { skipSync: true });
        if (result.success) {
            if (navigation === folder.uid) setNavigation('all');
            const msg = deleteCollections
                ? `Folder and ${result.collectionsDeleted} collection(s) deleted`
                : `Folder deleted (${result.collectionsMovedToRoot} collection(s) moved to root)`;
            showSuccessToast(msg);
            if (onDataUpdate) await onDataUpdate();
            await runTrackedSync();
        } else if (result.blocked) {
            setNoPermissionOpen(true);
        } else {
            showErrorToast('Failed to delete folder');
        }
    }, [deleteModal, navigation, setNavigation, onDataUpdate, runTrackedSync, setNoPermissionOpen]);

    const navItems = [
        { key: 'all', label: 'All Collections', count: allCount, icon: HiCollection },
        { key: 'favorites', label: 'Favorites', count: favoritesCount, icon: MdStar },
        { key: 'current-windows', label: 'Current Windows', count: currentWindowCount, icon: MdOpenInBrowser },
        { key: 'sessions', label: 'Recently Closed', count: sessionCount, icon: MdHistory },
    ];

    const draggedParentId = draggingCollection?.collection?.parentId || null;
    const draggedIsAtRoot = !draggedParentId || !folders.some((folder) => folder.uid === draggedParentId);
    const isNoFolderDropTarget = isDraggingCollection && !draggedIsAtRoot;
    const isNoFolderHovered = isNoFolderDropTarget && dragOverTargetId === 'no-folder';
    const noFolderDragClasses = isNoFolderDropTarget
        ? `${isNoFolderHovered ? ' fp-sidebar-drop-over' : ' fp-sidebar-drop-active'}`
        : '';

    const getFolderDragClasses = (folderUid) => {
        const isSameFolder = draggingCollection?.collection?.parentId === folderUid;
        const isDropTarget = isDraggingCollection && !isSameFolder;
        const isHovered = isDropTarget && dragOverTargetId === folderUid;
        return isDropTarget
            ? `${isHovered ? ' fp-sidebar-drop-over' : ' fp-sidebar-drop-active'}`
            : '';
    };

    const getFolderColor = (folder) => (
        folder.color && folder.color !== 'default'
            ? getColorValue(folder.color)
            : 'var(--primary-color)'
    );

    return (<>
        <aside className={`fp-sidebar ${collapsed ? 'fp-sidebar-collapsed' : ''}`}>
            {/* Collapse toggle */}
            <button
                className="fp-sidebar-toggle"
                onClick={() => setCollapsed(!collapsed)}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {collapsed ? <MdChevronRight size={18} /> : <MdChevronLeft size={18} />}
            </button>

            {/* Save button */}
            <div className="fp-sidebar-save-section">
                <button
                    className="fp-sidebar-save-btn"
                    onClick={() => { setSearch(null); setSaveModalOpen(true); }}
                    aria-label="Save Current Tabs"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Save Current Tabs"
                >
                    <MdSave size={18} />
                    {!collapsed && <span>Save Current Tabs</span>}
                </button>
            </div>

            {/* Quick filters */}
            <nav className="fp-sidebar-nav">
                {navItems.map(item => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.key}
                            className={`fp-sidebar-nav-item ${navigation === item.key ? 'active' : ''}`}
                            onClick={() => setNavigation(item.key)}
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content={collapsed ? item.label : ''}
                        >
                            <Icon size={20} className="fp-sidebar-nav-icon" />
                            {!collapsed && (
                                <>
                                    <span className="fp-sidebar-nav-label">{item.label}</span>
                                    <SidebarCounter value={item.count} className="fp-sidebar-nav-count" />
                                </>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Folders scroll region */}
            {!collapsed && (
                <div className="fp-sidebar-folders">
                    {/* Shared folders + pending invite ghosts */}
                    {(sharedFolders.length > 0 || pendingInvites.length > 0) && (
                        <div className="fp-sidebar-shared-section">
                    <div className="fp-sidebar-folders-header">
                        <span className="fp-sidebar-folders-title fp-sidebar-shared-title">
                            <MdFolderShared size={16} className="fp-sidebar-shared-title-icon" aria-hidden="true" />
                            Shared Folders
                        </span>
                        {pendingInvites.length > 0 && (
                            <SidebarCounter
                                value={pendingInvites.length}
                                className="fp-sidebar-shared-pending-count"
                            />
                        )}
                    </div>
                    <div className="fp-sidebar-folder-list">
                        {sharedFolders.map((folder) => (
                            <div key={folder.uid} className="fp-sidebar-folder-row">
                                <button
                                    type="button"
                                    className={`fp-sidebar-folder-item fp-sidebar-shared-folder-item ${navigation === folder.uid ? 'active' : ''}${getFolderDragClasses(folder.uid)}`}
                                    onClick={() => setNavigation(folder.uid)}
                                    onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                                >
                                    <MdFolderShared
                                        size={20}
                                        className="fp-sidebar-folder-icon"
                                        style={{ color: getFolderColor(folder) }}
                                    />
                                    <span className="fp-sidebar-folder-name">{folder.name}</span>
                                    <SidebarCounter value={folderCounts[folder.uid] || 0} className="fp-sidebar-folder-count" />
                                </button>
                            </div>
                        ))}
                        {pendingInvites.map((invite) => {
                            const isBusy = inviteBusyId === invite.folderId;
                            return (
                                <div
                                    key={invite.folderId}
                                    className={`fp-sidebar-ghost-row ${isBusy ? 'fp-sidebar-ghost-busy' : ''}`.trim()}
                                >
                                    <MdFolderShared size={20} className="fp-sidebar-folder-icon fp-sidebar-ghost-icon" aria-hidden="true" />
                                    <span className="fp-sidebar-ghost-copy">
                                        <span className="fp-sidebar-folder-name">{invite.folderName}</span>
                                        <span className="fp-sidebar-ghost-owner">
                                            {invite.ownerFirstName || invite.ownerEmail}{invite.role === 'read' ? ' · View only' : ''}
                                        </span>
                                    </span>
                                    <span className="fp-sidebar-ghost-actions">
                                        <button
                                            type="button"
                                            className="fp-sidebar-ghost-btn fp-sidebar-ghost-accept"
                                            disabled={isBusy}
                                            onClick={() => handleInviteAccept(invite)}
                                            aria-label={`Accept invite to "${invite.folderName}"`}
                                            data-tooltip-id="main-tooltip"
                                            data-tooltip-content={`Accept invite from ${invite.ownerFirstName || invite.ownerEmail}`}
                                            data-tooltip-class-name="small-tooltip"
                                        >
                                            {isBusy ? 'Accepting…' : 'Accept'}
                                        </button>
                                        <button
                                            type="button"
                                            className="fp-sidebar-ghost-btn fp-sidebar-ghost-decline"
                                            disabled={isBusy}
                                            onClick={() => handleInviteDecline(invite)}
                                            aria-label={`Decline invite to "${invite.folderName}"`}
                                            data-tooltip-id="main-tooltip"
                                            data-tooltip-content="Decline this invite"
                                            data-tooltip-class-name="small-tooltip"
                                        >
                                            Decline
                                        </button>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                        </div>
                    )}

                    {/* Folders */}
                    <div className="fp-sidebar-regular-folders">
                    <div className="fp-sidebar-folders-header">
                        <span className="fp-sidebar-folders-title">Folders</span>
                        <button
                            className="fp-sidebar-add-folder"
                            onClick={() => setFolderModalOpen(true)}
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content="Create folder"
                        >
                            <MdCreateNewFolder size={18} />
                        </button>
                    </div>
                    <div className="fp-sidebar-folder-list">
                        <div className="fp-sidebar-folder-row">
                            <button
                                type="button"
                                className={`fp-sidebar-folder-item fp-sidebar-root-item ${navigation === 'unorganized' ? 'active' : ''}${noFolderDragClasses}`}
                                onClick={() => setNavigation('unorganized')}
                                data-sidebar-no-folder="true"
                            >
                                <span className="fp-sidebar-root-icon-shell" aria-hidden="true">
                                    <MdInbox size={18} className="fp-sidebar-folder-icon fp-sidebar-root-icon" />
                                </span>
                                <span className="fp-sidebar-root-copy">
                                    <span className="fp-sidebar-folder-name">Root Level</span>
                                    <span className="fp-sidebar-root-description">Collections not saved in any folder</span>
                                </span>
                                <SidebarCounter value={unorganizedCount} className="fp-sidebar-folder-count" />
                            </button>
                        </div>
                    </div>
                    {regularFolders.length > 0 ? (
                        <DndContext
                            sensors={folderSortSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleFolderSortEnd}
                        >
                            <SortableContext
                                items={sortableFolderIds}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="fp-sidebar-folder-list">
                                    {regularFolders.map((folder) => (
                                        <SortableSidebarFolderItem
                                            key={folder.uid}
                                            folder={folder}
                                            isActive={navigation === folder.uid}
                                            color={getFolderColor(folder)}
                                            count={folderCounts[folder.uid] || 0}
                                            dragClasses={getFolderDragClasses(folder.uid)}
                                            disableSorting={isDraggingCollection}
                                            onSelect={setNavigation}
                                            onContextMenu={handleFolderContextMenu}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <div className="fp-sidebar-no-folders">No folders yet</div>
                    )}
                    </div>
                </div>
            )}

            {/* Command palette shortcut hint */}
            <button
                className="fp-sidebar-shortcut-hint"
                onClick={() => setCommandPaletteOpen(true)}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={collapsed ? `${isMac ? '⌘' : 'Ctrl+'}K — Command Palette` : ''}
            >
                <MdSearch size={20} />
                {!collapsed && (
                    <>
                        <span>Command Palette</span>
                        <kbd>{isMac ? '⌘' : 'Ctrl+'}K</kbd>
                    </>
                )}
            </button>

            {/* Stats */}
            {!collapsed && (
                <div className="fp-sidebar-stats">
                    <div className="fp-sidebar-stat-card">
                        <span className="fp-sidebar-stat-value">{allCount}</span>
                        <span className="fp-sidebar-stat-label">Collection{allCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="fp-sidebar-stat-card">
                        <span className="fp-sidebar-stat-value">{totalTabs}</span>
                        <span className="fp-sidebar-stat-label">Tab{totalTabs !== 1 ? 's' : ''}</span>
                    </div>
                </div>
            )}

            {/* Folder creation modal */}
            <Suspense fallback={null}>
                <CreateFolderModal
                    isOpen={folderModalOpen}
                    onClose={() => setFolderModalOpen(false)}
                    onSave={handleFolderCreate}
                />
            </Suspense>

            {/* Edit folder modal */}
            <Suspense fallback={null}>
                <CreateFolderModal
                    isOpen={!!editFolder}
                    onClose={() => setEditFolder(null)}
                    onSave={handleFolderEdit}
                    folder={editFolder}
                />
            </Suspense>

            {/* Folder delete confirmation modal */}
            <Suspense fallback={null}>
                <FolderDeleteConfirmModal
                    isOpen={!!deleteModal}
                    onClose={() => setDeleteModal(null)}
                    onConfirm={handleDeleteConfirm}
                    folderName={deleteModal?.folder?.name || ''}
                    collectionCount={deleteModal?.collectionCount || 0}
                />
            </Suspense>

            {/* Save collection modal */}
            <Suspense fallback={null}>
                <SaveCollectionModal
                    isOpen={saveModalOpen}
                    onClose={() => setSaveModalOpen(false)}
                    folders={folders}
                    addCollection={addCollection}
                    addFolder={addFolder}
                    onDataUpdate={onDataUpdate}
                    onSaved={onCollectionsRevealed}
                />
            </Suspense>
        </aside>

        {ctxMenu && (
            <FPCtxMenu
                menuRef={ctxMenuRef}
                x={ctxMenu.x}
                y={ctxMenu.y}
                items={createFolderMenuItems({
                    folder: ctxMenu.folder,
                    isPro,
                    hasTrackedCollections: ctxHasTracked,
                    onOpenAll: handleCtxOpenAll,
                    onEdit: handleCtxEdit,
                    onExport: handleCtxExport,
                    onDuplicate: handleCtxDuplicate,
                    onCopyUrls: handleCtxCopyUrls,
                    onStopTracking: handleCtxStopTracking,
                    onShare: handleCtxShare,
                    onUnshare: handleCtxUnshare,
                    onLeave: handleCtxLeaveShared,
                    onDelete: handleCtxDelete,
                })}
            />
        )}
    </>
    );
}

export default FPSidebar;
