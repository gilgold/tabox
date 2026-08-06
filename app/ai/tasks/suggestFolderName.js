import { createAISession, promptForJSON } from '../aiClient';

// Folder names share the 50-char cap used elsewhere.
const MAX_NAME_LENGTH = 50;
const MAX_COLLECTIONS = 20; // bounds prompt length — avoid exceeding context budget
const MAX_TITLES_PER_COLLECTION = 5; // bounds prompt length — avoid exceeding context budget

const NAME_SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string', maxLength: MAX_NAME_LENGTH },
    },
    required: ['name'],
    additionalProperties: false,
};

export function buildFolderNamePrompt({ collections = [] } = {}) {
    const blocks = collections.slice(0, MAX_COLLECTIONS).map((collection) => {
        const titles = (collection.tabs || [])
            .slice(0, MAX_TITLES_PER_COLLECTION)
            .map((tab) => tab.title || tab.url || 'Untitled');
        const titleLine = titles.length ? `\n  tabs: ${titles.join('; ')}` : '';
        return `- ${collection.name || 'Untitled'}${titleLine}`;
    });
    return `Suggest a short, descriptive name for a folder that groups these tab collections.\n\n`
        + `Prefer naming the folder after the common theme of the collection names. If the `
        + `collection names are generic or unhelpful (for example "Untitled" or "New Collection"), `
        + `infer the theme from the tab titles instead.\n\n`
        + `Collections:\n${blocks.join('\n')}\n\nRespond with JSON: {"name": "..."}`;
}

export async function suggestFolderName(input, { signal } = {}) {
    // The Prompt API requires temperature and topK to be set together.
    const session = await createAISession({
        systemPrompt: 'You name folders that group browser-tab collections. Names are short (2-4 words), specific, and in Title Case. Never include quotes or emojis.',
        temperature: 0.7,
        topK: 3,
        ...(signal ? { signal } : {}),
    });
    try {
        const { name } = await promptForJSON(session, buildFolderNamePrompt(input), NAME_SCHEMA, signal);
        return String(name).trim().substring(0, MAX_NAME_LENGTH);
    } finally {
        session.destroy();
    }
}
