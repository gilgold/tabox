// chrome/ai-planners.js
// Plain-JS port of AI prompt builders, JSON schemas, and output normalizers from:
//   app/ai/tasks/suggestCollectionName.js
//   app/ai/tasks/autoArrangeCollections.js
//   app/ai/tasks/smartOrganizeTabs.js
//
// This module is PURE — no AI calls, no storage, no external globals.
// The SW loads it via importScripts; tests load it via require().
// Dual-export pattern: globalThis.TaboxAIPlanners + module.exports.
(() => {

// ---------------------------------------------------------------------------
// suggestCollectionName constants + builders
// ---------------------------------------------------------------------------

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

function buildNamePrompt(collection) {
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

// ---------------------------------------------------------------------------
// autoArrangeCollections constants + builders + normalizer
// ---------------------------------------------------------------------------

const ARRANGE_MAX_NAME_LENGTH = 50;
const MAX_COLLECTIONS = 20; // bounds prompt length
const MAX_TITLES_PER_COLLECTION = 5; // bounds prompt length
const CATCHALL_FOLDER_NAME = 'Misc';

const ARRANGE_SCHEMA = {
    type: 'object',
    properties: {
        assignments: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    collectionId: { type: 'string' },
                    existingFolderId: { type: ['string', 'null'] },
                    newFolderName: { type: ['string', 'null'], maxLength: ARRANGE_MAX_NAME_LENGTH },
                },
                required: ['collectionId'],
                additionalProperties: false,
            },
        },
    },
    required: ['assignments'],
    additionalProperties: false,
};

function buildArrangePrompt({ collections = [], existingFolders = [] } = {}) {
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
        existingFolders && existingFolders.length ? `Existing folders:\n${folderLines.join('\n')}` : 'No existing folders.',
        '',
        'Respond with JSON: { "assignments": [ { "collectionId": "...", "existingFolderId": null, "newFolderName": "Reading" } ] }.',
    ].join('\n');
}

/**
 * Normalize the raw model output for autoArrangeCollections.
 * @param {object} raw - Raw model output with `.assignments` array.
 * @param {Array}  capped - Collections already sliced to MAX_COLLECTIONS.
 * @param {Array}  existingFolders - The existing folders passed to buildArrangePrompt.
 * @returns {{ assignments: Array }}
 */
function normalizeArrangePlan(raw, capped, existingFolders) {
    const validFolderIds = new Set((existingFolders || []).map((f) => f.id));
    const existingByLowerName = new Map((existingFolders || []).map((f) => [String(f.name).toLowerCase(), f.id]));

    const byId = new Map((raw.assignments || []).map((a) => [a.collectionId, a]));
    const assignments = capped.map((c) => {
        const a = byId.get(c.uid);
        // Normalize model output: ensure each assignment ends with exactly one non-null target
        // (existingFolderId XOR newFolderName). The JSON schema can't express mutual exclusion,
        // so we enforce it here.
        let existingFolderId = a && a.existingFolderId != null && validFolderIds.has(a.existingFolderId)
            ? a.existingFolderId
            : null;
        let newFolderName = a && a.newFolderName ? String(a.newFolderName).trim().slice(0, ARRANGE_MAX_NAME_LENGTH) : null;

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

// ---------------------------------------------------------------------------
// smartOrganizeTabs constants + builders + normalizer
// ---------------------------------------------------------------------------

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const ORGANIZE_MAX_TABS = 50;
const ORGANIZE_MAX_NAME_LENGTH = 40;
const TITLE_TRUNC = 80;

const ORGANIZE_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', maxLength: ORGANIZE_MAX_NAME_LENGTH },
                    color: { type: 'string', enum: GROUP_COLORS },
                    existingGroupId: { type: ['integer', 'null'] },
                    tabIndexes: { type: 'array', items: { type: 'integer' } },
                },
                required: ['tabIndexes'],
                additionalProperties: false,
            },
        },
    },
    required: ['groups'],
    additionalProperties: false,
};

function domainOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

function buildOrganizePrompt({ ungroupedTabs, existingGroups }) {
    const tabLines = ungroupedTabs.map((tab, i) => {
        const domain = domainOf(tab.url);
        const title = (tab.title || domain || 'Untitled').slice(0, TITLE_TRUNC);
        return `${i + 1}. ${title}${domain ? ` (${domain})` : ''}`;
    });
    const groupLines = (existingGroups || []).map((g) => (
        `- [id ${g.id}] "${g.title}"${g.sampleTitles && g.sampleTitles.length ? ` e.g. ${g.sampleTitles.slice(0, 3).join('; ')}` : ''}`
    ));
    return [
        'You organize a browser window. Cluster these ungrouped tabs into a small number of topical groups.',
        'If a tab clearly belongs to one of the existing groups, assign it there by setting existingGroupId to that id.',
        'Otherwise create a new group with a short Title Case name (2-4 words) and a color.',
        'Put anything that fits nothing into a group named "Other".',
        '',
        'Ungrouped tabs (referenced by number):',
        tabLines.join('\n'),
        '',
        existingGroups && existingGroups.length ? `Existing groups:\n${groupLines.join('\n')}` : 'No existing groups.',
        '',
        'Respond with JSON: { "groups": [ { "name": "...", "color": "blue", "existingGroupId": null, "tabIndexes": [1,2] } ] }.',
        `Colors must be one of: ${GROUP_COLORS.join(', ')}.`,
    ].join('\n');
}

/**
 * Normalize the raw model output for smartOrganizeTabs.
 * NOTE: skippedTabIds is NOT computed here — the task module computes it from
 * the full ungroupedTabs list (ungroupedTabs.slice(ORGANIZE_MAX_TABS)).
 * @param {object} raw          - Raw model output with `.groups` array.
 * @param {Array}  capped       - Tabs already sliced to ORGANIZE_MAX_TABS.
 * @param {Array}  existingGroups - The existing groups passed to buildOrganizePrompt.
 * @returns {{ newGroups: Array, additions: Array }}
 */
function normalizeOrganizePlan(raw, capped, existingGroups) {
    const indexToTabId = new Map(capped.map((t, i) => [i + 1, t.tabId]));
    const existingIds = new Set((existingGroups || []).map((g) => g.id));

    const placed = new Set();
    const newGroups = [];
    const additions = [];
    let colorCursor = 0;
    const nextColor = (c) => (GROUP_COLORS.includes(c) ? c : GROUP_COLORS[colorCursor++ % GROUP_COLORS.length]);

    for (const g of (raw.groups || [])) {
        const tabIds = (g.tabIndexes || [])
            .map((idx) => indexToTabId.get(idx))
            .filter((id) => id !== undefined && !placed.has(id));
        if (tabIds.length === 0) continue;
        tabIds.forEach((id) => placed.add(id));

        if (g.existingGroupId != null && existingIds.has(g.existingGroupId)) {
            additions.push({ groupId: g.existingGroupId, tabIds });
        } else {
            newGroups.push({ name: (g.name || 'Group').slice(0, ORGANIZE_MAX_NAME_LENGTH), color: nextColor(g.color), tabIds });
        }
    }

    // Anything in the capped set the model didn't place goes into "Other".
    const leftover = capped.map((t) => t.tabId).filter((id) => !placed.has(id));
    if (leftover.length > 0) {
        const existingOther = newGroups.find((g) => g.name === 'Other');
        if (existingOther) existingOther.tabIds.push(...leftover);
        else newGroups.push({ name: 'Other', color: nextColor('grey'), tabIds: leftover });
    }

    return { newGroups, additions };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const taboxAIPlannersApi = {
    // suggestCollectionName
    MAX_NAME_LENGTH,
    MAX_TABS,
    NAME_SCHEMA,
    buildNamePrompt,
    // autoArrangeCollections
    MAX_COLLECTIONS,
    MAX_TITLES_PER_COLLECTION,
    CATCHALL_FOLDER_NAME,
    ARRANGE_SCHEMA,
    buildArrangePrompt,
    normalizeArrangePlan,
    // smartOrganizeTabs
    GROUP_COLORS,
    ORGANIZE_MAX_TABS,
    ORGANIZE_MAX_NAME_LENGTH,
    TITLE_TRUNC,
    ORGANIZE_SCHEMA,
    buildOrganizePrompt,
    normalizeOrganizePlan,
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIPlanners = taboxAIPlannersApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = taboxAIPlannersApi;

})();
