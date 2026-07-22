import { MdDelete, MdOutlineRefresh, MdCallSplit, MdLink, MdCenterFocusWeak, MdOpenInBrowser, MdEdit, MdPersonAdd, MdLinkOff, MdLogout } from 'react-icons/md';
import { CiExport } from 'react-icons/ci';
import { FaStop } from 'react-icons/fa6';
import { FaStar, FaRegStar, FaPlay } from 'react-icons/fa';
import { MdContentCopy } from 'react-icons/md';
import { SPLIT_MIN_TABS } from './sharedConstants';
import { buildFolderMenuItems } from './folderMenuItems';
import AiBadge from '../AiBadge';

const ICON_SIZE = 16;

// Collection menu items. Each item carries a `group` tag; renderers draw a
// divider whenever the group changes between consecutive visible items.
export const createCollectionMenuItems = ({
    isAutoUpdate = false,
    onOpenTabs,
    onFocusWindow,
    onExport,
    onUpdate,
    onStopTracking,
    onDelete,
    onDuplicate,
    onCopyUrls,
    isFavorite = false,
    onToggleFavorite,
    aiEnabled = false,
    isPro = false,
    tabCount = 0,
    onSplitCollection,
    onShareLink
}) => [
    {
        id: 'open-tabs',
        text: 'Open Tabs',
        icon: <FaPlay size={12} />,
        action: onOpenTabs,
        className: '',
        group: 'open',
        condition: !isAutoUpdate && typeof onOpenTabs === 'function'
    },
    {
        id: 'focus-window',
        text: 'Focus Window',
        icon: <MdCenterFocusWeak size={ICON_SIZE} />,
        action: onFocusWindow,
        className: '',
        group: 'open',
        condition: isAutoUpdate && typeof onFocusWindow === 'function'
    },
    {
        id: 'share-link',
        group: 'main',
        text: 'Share via Link',
        icon: <MdLink size={ICON_SIZE} />,
        action: onShareLink,
        className: '',
        condition: typeof onShareLink === 'function',
        proBadge: !isPro
    },
    {
        id: 'update',
        group: 'main',
        text: 'Update Collection',
        icon: <MdOutlineRefresh size={ICON_SIZE} />,
        action: onUpdate,
        className: '',
        condition: !isAutoUpdate
    },
    {
        id: 'stop-tracking',
        group: 'main',
        text: 'Stop Auto Update',
        icon: <FaStop size={ICON_SIZE} />,
        action: onStopTracking,
        className: '',
        condition: isAutoUpdate
    },
    {
        id: 'export',
        group: 'main',
        text: 'Export Collection',
        icon: <CiExport size={ICON_SIZE} />,
        action: onExport,
        className: '',
        condition: true
    },
    {
        id: 'duplicate',
        group: 'main',
        text: 'Duplicate Collection',
        icon: <MdContentCopy size={ICON_SIZE} />,
        action: onDuplicate,
        className: '',
        condition: true
    },
    {
        id: 'favorite',
        group: 'main',
        text: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        icon: isFavorite ? <FaStar size={ICON_SIZE} /> : <FaRegStar size={ICON_SIZE} />,
        action: onToggleFavorite,
        className: '',
        condition: typeof onToggleFavorite === 'function'
    },
    {
        id: 'copy-urls',
        group: 'main',
        text: 'Copy all URLs',
        icon: <MdContentCopy size={ICON_SIZE} />,
        action: onCopyUrls,
        className: '',
        condition: true
    },
    {
        id: 'split-collection',
        group: 'main',
        text: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <AiBadge />
                Split Collection
            </span>
        ),
        icon: <MdCallSplit size={ICON_SIZE} />,
        action: onSplitCollection,
        className: '',
        condition: aiEnabled && tabCount >= SPLIT_MIN_TABS && typeof onSplitCollection === 'function'
    },
    {
        id: 'delete',
        group: 'danger',
        text: 'Delete Collection',
        icon: <MdDelete size={ICON_SIZE} />,
        action: onDelete,
        className: 'danger',
        condition: true
    }
];

// Icons and groups for the entries the pure buildFolderMenuItems adds
// (share/unshare/leave-shared/delete). Kept here so every view renders the
// exact same folder menu.
const FOLDER_BUILDER_ICONS = {
    share: <MdPersonAdd size={ICON_SIZE} />,
    unshare: <MdLinkOff size={ICON_SIZE} />,
    'leave-shared': <MdLogout size={ICON_SIZE} />,
    delete: <MdDelete size={ICON_SIZE} />,
};

const FOLDER_BUILDER_GROUPS = {
    share: 'share',
    unshare: 'danger',
    'leave-shared': 'danger',
    delete: 'danger',
};

// Folder menu items — the single source of truth for the folder context menu
// in the popup (FolderContainer) and the full-page view (FPSidebar /
// FPContentArea). Composes the pure shared-permission builder
// (buildFolderMenuItems) with the standard entries, icons and divider groups.
export const createFolderMenuItems = ({
    folder,
    isPro = false,
    hasTrackedCollections = false,
    onOpenAll,
    onEdit,
    onExport,
    onDuplicate,
    onCopyUrls,
    onStopTracking,
    onShare,
    onUnshare,
    onLeave,
    onDelete,
}) => {
    const existingItems = [
        {
            id: 'open-all',
            group: 'main',
            text: 'Open All Collections',
            icon: <MdOpenInBrowser size={ICON_SIZE} />,
            action: onOpenAll,
            className: '',
            condition: typeof onOpenAll === 'function'
        },
        {
            id: 'edit',
            group: 'main',
            text: 'Edit Folder',
            icon: <MdEdit size={ICON_SIZE} />,
            action: onEdit,
            className: '',
            condition: typeof onEdit === 'function'
        },
        {
            id: 'export',
            group: 'main',
            text: 'Export Folder',
            icon: <CiExport size={ICON_SIZE} />,
            action: onExport,
            className: '',
            condition: true
        },
        {
            id: 'duplicate',
            group: 'main',
            text: 'Duplicate Folder',
            icon: <MdContentCopy size={ICON_SIZE} />,
            action: onDuplicate,
            className: '',
            condition: true
        },
        {
            id: 'copy-folder-urls',
            group: 'main',
            text: 'Copy all URLs in folder',
            icon: <MdContentCopy size={ICON_SIZE} />,
            action: onCopyUrls,
            className: '',
            condition: true
        },
        {
            id: 'stop-tracking-folder',
            group: 'main',
            text: 'Stop Auto Tracking Folder',
            icon: <FaStop size={ICON_SIZE} />,
            action: onStopTracking,
            className: '',
            condition: hasTrackedCollections && typeof onStopTracking === 'function'
        },
    ];

    return buildFolderMenuItems({
        folder,
        onShare,
        onDelete,
        onLeave,
        onUnshare,
        isPro,
        existingItems,
    }).map((item) => ({
        ...item,
        icon: item.icon || FOLDER_BUILDER_ICONS[item.id],
        group: item.group || FOLDER_BUILDER_GROUPS[item.id] || 'main',
    }));
};
