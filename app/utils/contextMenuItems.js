import { MdDelete, MdOutlineRefresh, MdCallSplit } from 'react-icons/md';
import { CiExport } from 'react-icons/ci';
import { FaStop } from 'react-icons/fa6';
import { FaStar, FaRegStar } from 'react-icons/fa';
import { MdContentCopy } from 'react-icons/md';
import { SPLIT_MIN_TABS } from './sharedConstants';
import AiBadge from '../AiBadge';

const ICON_SIZE = 16;

// Collection menu items
export const createCollectionMenuItems = ({
    isAutoUpdate = false,
    onExport,
    onUpdate,
    onStopTracking,
    onDelete,
    onDuplicate,
    onCopyUrls,
    isFavorite = false,
    onToggleFavorite,
    aiEnabled = false,
    tabCount = 0,
    onSplitCollection
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
        id: 'favorite',
        text: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        icon: isFavorite ? <FaStar size={ICON_SIZE} /> : <FaRegStar size={ICON_SIZE} />,
        action: onToggleFavorite,
        className: '',
        condition: typeof onToggleFavorite === 'function'
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
        id: 'split-collection',
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
        text: 'Delete Collection',
        icon: <MdDelete size={ICON_SIZE} />,
        action: onDelete,
        className: 'danger',
        condition: true
    }
];
