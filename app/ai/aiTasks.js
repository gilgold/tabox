import { MdDriveFileRenameOutline, MdAutoAwesomeMosaic, MdCreateNewFolder, MdContentCopy, MdCallSplit } from 'react-icons/md';

// Registry of AI tools shown in the AI Tools modal.
// To add a new AI feature whose work runs in the service worker:
//   1. Add chrome/ai-task-<name>.js that self-registers with TaboxAIRegistry.
//   2. Add an importScripts line for it in chrome/background.js.
//   3. Add an entry to AI_TOOLS below plus a panel branch in app/AIToolsModal.js
//      keyed by the tool id (it renders the list and routes by id).
export const AI_TOOLS = [
    {
        id: 'smart-organize',
        title: 'Smart Tab Grouping',
        description: 'Group this window’s loose tabs into tab groups automatically.',
        icon: MdAutoAwesomeMosaic,
        featured: true,
    },
    {
        id: 'auto-rename',
        title: 'Auto rename collections',
        description: 'Let AI suggest a name for a collection based on its tabs.',
        icon: MdDriveFileRenameOutline,
    },
    {
        id: 'auto-arrange-folders',
        title: 'Auto-arrange into folders',
        description: 'Sort your loose collections into folders automatically.',
        icon: MdCreateNewFolder,
    },
    {
        id: 'duplicate-sweep',
        title: 'Duplicate-tab sweep',
        description: 'Find duplicate tabs across collections and decide where to keep them.',
        icon: MdContentCopy,
    },
    {
        id: 'split-collection',
        title: 'Split a collection',
        description: 'Break an oversized collection into themed sub-collections.',
        icon: MdCallSplit,
    },
];
