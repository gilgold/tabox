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

// Auto-arrange folder-name cap; kept distinct from MAX_NAME_LENGTH (collection names) so the two limits can diverge independently.
const ARRANGE_MAX_NAME_LENGTH = 50;
const MAX_COLLECTIONS = 20; // bounds prompt length
const MAX_TITLES_PER_COLLECTION = 5; // bounds prompt length
const CATCHALL_FOLDER_NAME = 'Misc';

const ARRANGE_SCHEMA = {
    type: 'object',
    properties: {
        folders: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    existingFolderId: { type: ['string', 'null'] },
                    newFolderName: { type: ['string', 'null'], maxLength: ARRANGE_MAX_NAME_LENGTH },
                    collectionIndexes: { type: 'array', items: { type: 'integer' } },
                },
                required: ['collectionIndexes'],
                additionalProperties: false,
            },
        },
    },
    required: ['folders'],
    additionalProperties: false,
};

function buildArrangePrompt({ collections = [], existingFolders = [] } = {}) {
    const capped = collections.slice(0, MAX_COLLECTIONS);
    const collectionBlocks = capped.map((c, i) => {
        const titles = (c.tabs || [])
            .slice(0, MAX_TITLES_PER_COLLECTION)
            .map((t) => t.title || t.url || 'Untitled');
        const titleLine = titles.length ? `\n  tabs: ${titles.join('; ')}` : '';
        return `${i + 1}. "${c.name || 'Untitled'}"${titleLine}`;
    });
    const folderLines = (existingFolders || []).map((f) => `- [id ${f.id}] "${f.name}"`);
    return [
        'You file browser-tab collections into folders. Every collection (referenced by its number) must end up in exactly one folder.',
        'Group collections that belong together into the same folder, listing their numbers together in one folder block.',
        'If the collections in this block belong in an existing folder, set existingFolderId to that folder id and leave newFolderName null.',
        'Otherwise create a new folder: set newFolderName to a short Title Case name (2-4 words) and leave existingFolderId null. Never set both.',
        'Prefer fuller folders over many tiny ones: avoid a folder holding a single collection when a broader shared '
            + 'folder by theme, or a suitable existing folder, fits instead.',
        '',
        'Collections (referenced by number):',
        collectionBlocks.join('\n'),
        '',
        existingFolders && existingFolders.length ? `Existing folders:\n${folderLines.join('\n')}` : 'No existing folders.',
        '',
        'Respond with JSON: { "folders": [ { "existingFolderId": null, "newFolderName": "Reading", "collectionIndexes": [1, 4] } ] }.',
    ].join('\n');
}

/**
 * Normalize the raw model output for autoArrangeCollections.
 * Input is folder-centric (folders[] each carrying collectionIndexes referencing the
 * 1-based order of `capped`). Output is the SAME per-collection contract as before:
 * { assignments: [{ collectionId, existingFolderId, newFolderName }] } with exactly one
 * non-null target each. Collections the model never placed fall back to the Misc catch-all.
 * @param {object} raw - Raw model output with `.folders` array.
 * @param {Array}  capped - Collections already sliced to MAX_COLLECTIONS.
 * @param {Array}  existingFolders - The existing folders passed to buildArrangePrompt.
 * @returns {{ assignments: Array }}
 */
function normalizeArrangePlan(raw, capped, existingFolders) {
    const validFolderIds = new Set((existingFolders || []).map((f) => f.id));
    const existingByLowerName = new Map((existingFolders || []).map((f) => [String(f.name).toLowerCase(), f.id]));
    const indexToUid = new Map(capped.map((c, i) => [i + 1, c.uid]));

    const targetByUid = new Map(); // uid -> { existingFolderId, newFolderName }
    const placed = new Set();

    const folders = (raw && Array.isArray(raw.folders)) ? raw.folders : [];
    for (const f of folders) {
        // Resolve each folder block to exactly one target (existingFolderId XOR newFolderName).
        // The JSON schema can't express mutual exclusion, so enforce it here.
        let existingFolderId = f && f.existingFolderId != null && validFolderIds.has(f.existingFolderId)
            ? f.existingFolderId
            : null;
        let newFolderName = f && f.newFolderName ? String(f.newFolderName).trim().slice(0, ARRANGE_MAX_NAME_LENGTH) : null;
        if (existingFolderId) {
            newFolderName = null;
        } else if (newFolderName) {
            const collide = existingByLowerName.get(newFolderName.toLowerCase());
            if (collide) { existingFolderId = collide; newFolderName = null; }
        }
        // Unusable block (no valid target) — its members stay unplaced and fall to Misc below.
        if (!existingFolderId && !newFolderName) continue;

        for (const idx of (Array.isArray(f.collectionIndexes) ? f.collectionIndexes : [])) {
            const uid = indexToUid.get(idx);
            if (uid === undefined || placed.has(uid)) continue; // first folder claiming a collection wins
            placed.add(uid);
            targetByUid.set(uid, { existingFolderId, newFolderName });
        }
    }

    const miscExisting = existingByLowerName.get(CATCHALL_FOLDER_NAME.toLowerCase()) || null;
    const assignments = capped.map((c) => {
        const t = targetByUid.get(c.uid);
        if (t) return { collectionId: c.uid, existingFolderId: t.existingFolderId, newFolderName: t.newFolderName };
        if (miscExisting) return { collectionId: c.uid, existingFolderId: miscExisting, newFolderName: null };
        return { collectionId: c.uid, existingFolderId: null, newFolderName: CATCHALL_FOLDER_NAME };
    });

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
// duplicate-sweep constants + builders + normalizer
// ---------------------------------------------------------------------------

const DEDUP_NEW_NAME_MAX = 40;
const DEDUP_MESSAGE_MAX = 240;

const DEDUP_SCHEMA = {
    type: 'object',
    properties: {
        recommendedKeeper: { type: 'integer' }, // 1-based index into the collection set
        message: { type: 'string', maxLength: DEDUP_MESSAGE_MAX },
        suggestedNewCollectionName: { type: 'string', maxLength: DEDUP_NEW_NAME_MAX },
        titles: {
            type: 'array',
            items: {
                type: 'object',
                properties: { urlIndex: { type: 'integer' }, title: { type: 'string' } },
                required: ['urlIndex', 'title'],
                additionalProperties: false,
            },
        },
    },
    required: ['recommendedKeeper', 'message'],
    additionalProperties: false,
};

function buildDedupPrompt(group, collectionNamesByUid) {
    const colLines = group.collectionUids.map((uid, i) => `${i + 1}. "${collectionNamesByUid[uid] || 'Untitled'}"`);
    const urlLines = group.urls.map((u, i) => {
        const titles = u.occurrences
            .map((o) => `${collectionNamesByUid[o.collectionUid] || '?'}: "${o.title || 'Untitled'}"`)
            .join('; ');
        return `${i + 1}. ${u.normalizedUrl}\n   titles: ${titles}`;
    });
    return [
        'These collections all contain the same tab(s). Recommend which SINGLE collection is the best home for them.',
        'Pick the clearest title for each shared tab when titles differ.',
        'Write one short, friendly sentence explaining the recommendation, e.g. "These tabs appear in Work, Read Later and Reference — consider keeping them in Reference only and removing them from the others."',
        'Also suggest a short Title Case name for a new collection in case the user prefers to split them out.',
        '',
        'Collections (referenced by number):',
        colLines.join('\n'),
        '',
        'Shared tabs (referenced by number):',
        urlLines.join('\n'),
        '',
        'Respond with JSON: { "recommendedKeeper": 1, "message": "...", "suggestedNewCollectionName": "...", "titles": [ { "urlIndex": 1, "title": "..." } ] }.',
    ].join('\n');
}

function normalizeDedupSuggestion(raw, group, collectionNamesByUid = {}) {
    const uids = group.collectionUids;
    const idx = raw && Number.isInteger(raw.recommendedKeeper) ? raw.recommendedKeeper - 1 : -1;
    const recommendedKeeperUid = (idx >= 0 && idx < uids.length) ? uids[idx] : uids[0];
    const namesForMsg = uids.map((u) => collectionNamesByUid[u] || u).join(', ');
    const message = (raw && typeof raw.message === 'string' && raw.message.trim())
        ? raw.message.trim().slice(0, DEDUP_MESSAGE_MAX)
        : `These tabs appear in ${namesForMsg} — consider keeping them in one collection only.`;
    const suggestedNewCollectionName = (raw && raw.suggestedNewCollectionName && String(raw.suggestedNewCollectionName).trim())
        ? String(raw.suggestedNewCollectionName).trim().slice(0, DEDUP_NEW_NAME_MAX)
        : 'Shared Tabs';
    const bestTitlePerUrl = [];
    for (const t of (raw && Array.isArray(raw.titles) ? raw.titles : [])) {
        const ui = Number.isInteger(t.urlIndex) ? t.urlIndex - 1 : -1;
        if (ui >= 0 && ui < group.urls.length && t.title && String(t.title).trim()) {
            bestTitlePerUrl.push({ normalizedUrl: group.urls[ui].normalizedUrl, title: String(t.title).trim() });
        }
    }
    return { recommendedKeeperUid, message, suggestedNewCollectionName, bestTitlePerUrl };
}

// True when at least one shared URL in the group has two or more *different*
// (non-empty) titles across its copies — i.e. a case where which copy to keep is
// genuinely ambiguous and worth an AI opinion. When false, the keeper can be
// chosen deterministically with no model call (the common "same page, same
// title, saved in several collections" case).
function dedupGroupHasTitleConflict(group) {
    const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return (group.urls || []).some((u) => {
        const titles = new Set((u.occurrences || []).map((o) => norm(o.title)));
        titles.delete('');
        return titles.size > 1;
    });
}

// Deterministic, no-AI recommendation for an unambiguous group. Reads naturally
// in the same style as the AI message, so the UI is consistent whether or not
// the model was consulted. `keeperUid` is chosen by the caller (e.g. freshest
// collection); falls back to the first collection if not in the set.
function buildDeterministicDedupSuggestion(group, collectionNamesByUid = {}, keeperUid) {
    const uids = group.collectionUids;
    const keeper = uids.includes(keeperUid) ? keeperUid : uids[0];
    const names = uids.map((u) => collectionNamesByUid[u] || u);
    const keeperName = collectionNamesByUid[keeper] || keeper;
    const others = uids.filter((u) => u !== keeper).map((u) => collectionNamesByUid[u] || u);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const tail = others.length > 1 ? 'the others' : (others[0] || 'the rest');
    const message = `These tabs appear in ${list} — consider keeping them in ${keeperName} only and removing them from ${tail}.`;
    return { recommendedKeeperUid: keeper, message: message.slice(0, DEDUP_MESSAGE_MAX), suggestedNewCollectionName: 'Shared Tabs', bestTitlePerUrl: [] };
}

// ---------------------------------------------------------------------------
// split-collection constants + builder + normalizer
// ---------------------------------------------------------------------------
const SPLIT_MIN_TABS = 30;        // keep in sync with app/utils/sharedConstants.js
const SPLIT_MAX_GROUPS = 4;
const SPLIT_MIN_GROUPS = 2;
const SPLIT_NAME_MAX = 40;

const SPLIT_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            minItems: SPLIT_MIN_GROUPS,
            maxItems: SPLIT_MAX_GROUPS,
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', maxLength: SPLIT_NAME_MAX },
                    tabIndices: { type: 'array', items: { type: 'integer' } },
                },
                required: ['name', 'tabIndices'],
                additionalProperties: false,
            },
        },
    },
    required: ['groups'],
    additionalProperties: false,
};

function buildSplitPrompt({ name, tabs }) {
    const tabLines = (tabs || []).map((tab, i) => {
        const domain = domainOf(tab.url);
        const title = (tab.title || domain || 'Untitled').slice(0, TITLE_TRUNC);
        return `${i + 1}. ${title}${domain ? ` (${domain})` : ''}`;
    });
    return [
        `Split the saved tab collection "${name || 'Untitled'}" into 2 to ${SPLIT_MAX_GROUPS} themed sub-collections.`,
        'Each tab must go into exactly one sub-collection. Reference tabs by their number.',
        'Give each sub-collection a short Title Case name (2-4 words), no quotes or emojis.',
        'Aim for roughly 3 groups when the topics support it.',
        '',
        'Tabs (referenced by number):',
        tabLines.join('\n'),
        '',
        'Respond with JSON: { "groups": [ { "name": "...", "tabIndices": [1,2,3] } ] }.',
    ].join('\n');
}

/**
 * Normalize/repair the raw model output for a split.
 * Input indices are 1-based (as prompted); output tabIndices are 0-based into `tabs`.
 * Guarantees a full partition: dedupe (first group wins), drop out-of-range,
 * sweep leftovers into "Misc", clamp to SPLIT_MAX_GROUPS.
 * @returns {{ ok: true, groups: Array<{name, tabIndices}> } | { ok: false, reason: string }}
 */
function normalizeSplitPlan(raw, tabs) {
    const total = (tabs || []).length;
    const placed = new Set();
    let groups = [];

    for (const g of (raw && raw.groups) || []) {
        const tabIndices = (g.tabIndices || [])
            .map((idx) => idx - 1)                       // 1-based → 0-based
            .filter((i) => Number.isInteger(i) && i >= 0 && i < total && !placed.has(i));
        if (tabIndices.length === 0) continue;
        tabIndices.forEach((i) => placed.add(i));
        groups.push({ name: (g.name || 'Group').trim().slice(0, SPLIT_NAME_MAX) || 'Group', tabIndices });
    }

    // Clamp to SPLIT_MAX_GROUPS by folding extras into the last kept group.
    if (groups.length > SPLIT_MAX_GROUPS) {
        const head = groups.slice(0, SPLIT_MAX_GROUPS - 1);
        const tail = groups.slice(SPLIT_MAX_GROUPS - 1);
        head.push({ name: tail[0].name, tabIndices: tail.flatMap((g) => g.tabIndices) });
        groups = head;
    }

    // Sweep any unplaced tabs into a Misc bucket so coverage is total.
    const leftover = [];
    for (let i = 0; i < total; i += 1) if (!placed.has(i)) leftover.push(i);
    if (leftover.length) {
        const misc = groups.find((g) => g.name === 'Misc');
        if (misc) misc.tabIndices.push(...leftover);
        else groups.push({ name: 'Misc', tabIndices: leftover });
    }

    if (groups.length < SPLIT_MIN_GROUPS) {
        return { ok: false, reason: 'too-few-groups' };
    }
    return { ok: true, groups };
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
    // split-collection
    SPLIT_MIN_TABS,
    SPLIT_MAX_GROUPS,
    SPLIT_MIN_GROUPS,
    SPLIT_SCHEMA,
    buildSplitPrompt,
    normalizeSplitPlan,
    // duplicate-sweep
    DEDUP_NEW_NAME_MAX,
    DEDUP_MESSAGE_MAX,
    DEDUP_SCHEMA,
    buildDedupPrompt,
    normalizeDedupSuggestion,
    dedupGroupHasTitleConflict,
    buildDeterministicDedupSuggestion,
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIPlanners = taboxAIPlannersApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = taboxAIPlannersApi;

})();
