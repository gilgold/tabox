import { createAISession, promptForJSON } from '../aiClient';

// Collection names are capped at 50 chars in CollectionDetailPanel's input.
const MAX_NAME_LENGTH = 50;
const MAX_TABS = 30;

const NAME_SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string', maxLength: MAX_NAME_LENGTH },
    },
    required: ['name'],
    additionalProperties: false,
};

export function buildNamePrompt(collection) {
    const lines = (collection.tabs || []).slice(0, MAX_TABS).map((tab) => {
        let domain = '';
        try {
            domain = new URL(tab.url).hostname.replace(/^www\./, '');
        } catch {
            // Tab URLs can be chrome://, about:blank, or malformed — skip the domain.
        }
        const title = tab.title || domain || 'Untitled';
        return `- ${title}${domain ? ` (${domain})` : ''}`;
    });
    return `Suggest a short, descriptive name for a group of browser tabs.\n\nTabs:\n${lines.join('\n')}\n\nRespond with JSON: {"name": "..."}`;
}

export async function suggestCollectionName(collection) {
    // Note: the Prompt API requires temperature and topK to be set together.
    const session = await createAISession({
        systemPrompt: 'You name groups of browser tabs. Names are short (2-4 words), specific, and in Title Case. Never include quotes or emojis.',
        temperature: 0.7,
        topK: 3,
    });
    try {
        const { name } = await promptForJSON(session, buildNamePrompt(collection), NAME_SCHEMA);
        return String(name).trim().substring(0, MAX_NAME_LENGTH);
    } finally {
        session.destroy();
    }
}
