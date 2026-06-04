import { MdDelete, MdOutlineRefresh } from 'react-icons/md';
import { CiExport } from 'react-icons/ci';
import { FaStop } from 'react-icons/fa6';
import { MdContentCopy } from 'react-icons/md';

const ICON_SIZE = 16;

// Collection menu items
export const createCollectionMenuItems = ({
    isAutoUpdate = false,
    onExport,
    onUpdate,
    onStopTracking,
    onDelete,
    onDuplicate,
    onCopyUrls
}) => [
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
        id: 'copy-urls',
        text: 'Copy all URLs',
        icon: <MdContentCopy size={ICON_SIZE} />,
        action: onCopyUrls,
        className: '',
        condition: true
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
