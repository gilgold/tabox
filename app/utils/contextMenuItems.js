import { MdDelete, MdOutlineRefresh } from 'react-icons/md';
import { CiExport } from 'react-icons/ci';
import { FaStop } from 'react-icons/fa6';
import { MdFolder, MdFolderOpen } from 'react-icons/md';
import { MdContentCopy } from 'react-icons/md';

const ICON_SIZE = 16;

// Collection menu items
export const createCollectionMenuItems = ({
    isAutoUpdate = false,
    onExport,
    onUpdate,
    onStopTracking,
    onDelete,
    onDuplicate
}) => [
    {
        id: 'export',
        text: 'Export Collection',
        icon: <CiExport size={ICON_SIZE} />,
        action: onExport,
        className: '',
        condition: true
    },
    {
        id: 'duplicate',
        text: 'Duplicate Collection',
        icon: <MdContentCopy size={ICON_SIZE} />,
        action: onDuplicate,
        className: '',
        condition: true
    },
    {
        id: 'update',
        text: 'Update Collection',
        icon: <MdOutlineRefresh size={ICON_SIZE} />,
        action: onUpdate,
        className: '',
        condition: !isAutoUpdate
    },
    {
        id: 'stop-tracking',
        text: 'Stop Auto Update',
        icon: <FaStop size={ICON_SIZE} />,
        action: onStopTracking,
        className: '',
        condition: isAutoUpdate
    },
    {
        id: 'delete',
        text: 'Delete Collection',
        icon: <MdDelete size={ICON_SIZE} />,
        action: onDelete,
        className: 'danger',
        condition: true
    }
];

// Folder menu items
export const createFolderMenuItems = ({
    onExport,
    onDelete,
    onToggleExpand,
    isExpanded = false
}) => [
    {
        id: 'export',
        text: 'Export Folder',
        icon: <CiExport size={ICON_SIZE} />,
        action: onExport,
        className: '',
        condition: true
    },
    {
        id: 'toggle-expand',
        text: isExpanded ? 'Collapse Folder' : 'Expand Folder',
        icon: isExpanded ? <MdFolder size={ICON_SIZE} /> : <MdFolderOpen size={ICON_SIZE} />,
        action: onToggleExpand,
        className: '',
        condition: true
    },
    {
        id: 'delete',
        text: 'Delete Folder',
        icon: <MdDelete size={ICON_SIZE} />,
        action: onDelete,
        className: 'danger',
        condition: true
    }
];

// Generic menu item creator for custom use cases
export const createMenuItem = ({
    id,
    text,
    icon,
    action,
    className = '',
    condition = true
}) => ({
    id,
    text,
    icon,
    action,
    className,
    condition
}); 