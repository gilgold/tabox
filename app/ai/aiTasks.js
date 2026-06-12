import { MdDriveFileRenameOutline } from 'react-icons/md';

// Registry of AI tools shown in the AI Tools modal.
// To add a new AI feature: implement it under app/ai/tasks/ and add an entry
// here; AIToolsModal renders the list and routes to the tool's panel by id.
export const AI_TOOLS = [
    {
        id: 'auto-rename',
        title: 'Auto-name collection',
        description: 'Let AI suggest a name for a collection based on its tabs.',
        icon: MdDriveFileRenameOutline,
    },
];
