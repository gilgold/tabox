import { MdDriveFileRenameOutline, MdAutoAwesomeMosaic, MdCreateNewFolder, MdContentCopy, MdCallSplit, MdChecklist } from 'react-icons/md';
import TaskPlannerToolIcon from './TaskPlannerToolIcon';
import SmartGroupingToolIcon from '../SmartGroupingToolIcon';

// Registry of AI tools shown in the AI Tools modal.
// To add a new AI feature whose work runs in the service worker:
//   1. Add chrome/ai-task-<name>.js that self-registers with TaboxAIRegistry
//      (or, for session-style tools like the Task Planner, its own SW module
//      with a private storage key).
//   2. Add an importScripts line for it in chrome/background.js.
//   3. Add an entry to AI_TOOLS below plus a panel branch in app/AIToolsModal.js
//      keyed by the tool id (it renders the list and routes by id).
//   4. Add an AI_ACTION_KEYWORDS entry in app/CommandPalette.js so the action
//      surfaces in the command palette (AI_ACTIONS derives from this registry).
//
// Optional per-tool fields:
//   - heroIcon: rich animated icon component rendered on the tool's hero card
//     in the AI Tools modal. `icon` stays the plain react-icons glyph (the
//     command palette uses it, and it's the hero fallback when heroIcon is unset).
//   - selfManagedStatus: true when the tool's panel manages its own progress
//     chrome; the modal must not lock Back/Close on panelStatus for it.
export const AI_TOOLS = [
    {
        id: 'task-planner',
        title: 'Task Planner',
        description: 'Chat with AI to gather the right websites for any task into a ready-to-save collection.',
        icon: MdChecklist,
        heroIcon: TaskPlannerToolIcon,
        featured: true,
        premium: true,
        selfManagedStatus: true,
    },
    {
        id: 'smart-organize',
        title: 'Smart Tab Grouping',
        description: 'Group this window’s loose tabs into tab groups automatically.',
        icon: MdAutoAwesomeMosaic,
        heroIcon: SmartGroupingToolIcon,
        featured: true,
        premium: true,
        // Builds real tab groups — hidden where the tabGroups API doesn't
        // exist (Firefox for Android); see isSupported in utils/platform.
        requires: 'tabGroups',
    },
    {
        id: 'auto-rename',
        title: 'Auto rename collections',
        description: 'Let AI suggest a name for a collection based on its tabs.',
        icon: MdDriveFileRenameOutline,
        premium: true,
    },
    {
        id: 'auto-arrange-folders',
        title: 'Auto-arrange into folders',
        description: 'Sort your loose collections into folders automatically.',
        icon: MdCreateNewFolder,
        premium: true,
    },
    {
        id: 'duplicate-sweep',
        title: 'Duplicate-tab sweep',
        description: 'Find duplicate tabs across collections and decide where to keep them.',
        icon: MdContentCopy,
        premium: true,
    },
    {
        id: 'split-collection',
        title: 'Split a collection',
        description: 'Break an oversized collection into themed sub-collections.',
        icon: MdCallSplit,
        premium: true,
        selfManagedStatus: true,
    },
];

// Paywall-only route used by the small sparkle buttons beside name fields.
// Paid users run the one-shot OpenRouter request in place; free users are sent
// to this shared upsell without adding a non-runnable card to the AI tools hub.
export const AI_NAME_SUGGESTION_TOOL = {
    id: 'name-suggestion',
    title: 'AI name suggestions',
    description: 'Generate concise collection and folder names from your tabs.',
    icon: MdDriveFileRenameOutline,
    premium: true,
};
