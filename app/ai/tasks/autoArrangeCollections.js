import { createAISession, promptForJSON } from '../aiClient';

const MAX_NAME_LENGTH = 50;
const MAX_COLLECTIONS = 20; // bounds prompt length
const MAX_TITLES_PER_COLLECTION = 5; // bounds prompt length
export const CATCHALL_FOLDER_NAME = 'Misc';

const PLAN_SCHEMA = {
    type: 'object',
    properties: {
        assignments: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    collectionId: { type: 'string' },
                    existingFolderId: { type: ['string', 'null'] },
                    newFolderName: { type: ['string', 'null'], maxLength: MAX_NAME_LENGTH },
                },
                required: ['collectionId'],
                additionalProperties: false,
            },
        },
    },
    required: ['assignments'],
    additionalProperties: false,
};

export function buildArrangePrompt({ collections = [], existingFolders = [] } = {}) {
    const collectionBlocks = collections.slice(0, MAX_COLLECTIONS).map((c) => {
        const titles = (c.tabs || [])
            .slice(0, MAX_TITLES_PER_COLLECTION)
            .map((t) => t.title || t.url || 'Untitled');
        const titleLine = titles.length ? `\n  tabs: ${titles.join('; ')}` : '';
        return `- [id ${c.uid}] "${c.name || 'Untitled'}"${titleLine}`;
    });
    const folderLines = (existingFolders || []).map((f) => `- [id ${f.id}] "${f.name}"`);
    return [
        'You file browser-tab collections into folders. Assign every collection to exactly one folder.',
        'If a collection clearly fits an existing folder, set existingFolderId to that folder id and leave newFolderName null.',
        'Otherwise create a new folder: set newFolderName to a short Title Case name (2-4 words) and leave existingFolderId null.',
        'Reuse the same newFolderName for collections that belong together. Never set both fields.',
        'Prefer fuller folders over many tiny ones: avoid creating a folder that holds only a single collection. '
            + 'If several collections would each end up alone in their own folder, group them into a broader shared '
            + 'folder by theme, or place them into a suitable existing folder, instead of making one folder per collection.',
        '',
        'Collections (referenced by id):',
        collectionBlocks.join('\n'),
        '',
        existingFolders?.length ? `Existing folders:\n${folderLines.join('\n')}` : 'No existing folders.',
        '',
        'Respond with JSON: { "assignments": [ { "collectionId": "...", "existingFolderId": null, "newFolderName": "Reading" } ] }.',
    ].join('\n');
}

export async function autoArrangeCollections({ collections = [], existingFolders = [], signal } = {}) {
    const capped = collections.slice(0, MAX_COLLECTIONS);
    const validFolderIds = new Set((existingFolders || []).map((f) => f.id));
    const existingByLowerName = new Map((existingFolders || []).map((f) => [String(f.name).toLowerCase(), f.id]));

    const session = await createAISession({
        systemPrompt: 'You sort browser-tab collections into folders. Folder names are short (2-4 words), specific, Title Case, no quotes or emojis.',
        temperature: 0.7,
        topK: 3,
        ...(signal ? { signal } : {}),
    });

    let raw;
    try {
        raw = await promptForJSON(session, buildArrangePrompt({ collections: capped, existingFolders }), PLAN_SCHEMA, signal);
    } finally {
        session.destroy();
    }

    const byId = new Map((raw.assignments || []).map((a) => [a.collectionId, a]));
    const assignments = capped.map((c) => {
        const a = byId.get(c.uid);
        // Normalize model output: ensure each assignment ends with exactly one non-null target
        // (existingFolderId XOR newFolderName). The JSON schema can't express mutual exclusion,
        // so we enforce it here.
        let existingFolderId = a && a.existingFolderId != null && validFolderIds.has(a.existingFolderId)
            ? a.existingFolderId
            : null;
        let newFolderName = a && a.newFolderName ? String(a.newFolderName).trim().slice(0, MAX_NAME_LENGTH) : null;

        if (existingFolderId) {
            newFolderName = null;
        } else if (newFolderName) {
            const collide = existingByLowerName.get(newFolderName.toLowerCase());
            if (collide) {
                existingFolderId = collide;
                newFolderName = null;
            }
        }

        if (!existingFolderId && !newFolderName) {
            const catchAllExisting = existingByLowerName.get(CATCHALL_FOLDER_NAME.toLowerCase());
            if (catchAllExisting) {
                existingFolderId = catchAllExisting;
            } else {
                newFolderName = CATCHALL_FOLDER_NAME;
            }
        }

        return { collectionId: c.uid, existingFolderId, newFolderName };
    });

    // Note: newFolderName is not deduped here — the apply step creates/reuses one folder per unique name.
    return { assignments };
}
