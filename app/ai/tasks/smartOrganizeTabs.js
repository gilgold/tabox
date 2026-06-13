import { createAISession, promptForJSON } from '../aiClient';

export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const MAX_TABS = 50;
const MAX_NAME_LENGTH = 40;
const TITLE_TRUNC = 80;

const PLAN_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', maxLength: MAX_NAME_LENGTH },
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

export function buildOrganizePrompt({ ungroupedTabs, existingGroups }) {
    const tabLines = ungroupedTabs.map((tab, i) => {
        const domain = domainOf(tab.url);
        const title = (tab.title || domain || 'Untitled').slice(0, TITLE_TRUNC);
        return `${i + 1}. ${title}${domain ? ` (${domain})` : ''}`;
    });
    const groupLines = (existingGroups || []).map((g) => (
        `- [id ${g.id}] "${g.title}"${g.sampleTitles?.length ? ` e.g. ${g.sampleTitles.slice(0, 3).join('; ')}` : ''}`
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
        existingGroups?.length ? `Existing groups:\n${groupLines.join('\n')}` : 'No existing groups.',
        '',
        'Respond with JSON: { "groups": [ { "name": "...", "color": "blue", "existingGroupId": null, "tabIndexes": [1,2] } ] }.',
        `Colors must be one of: ${GROUP_COLORS.join(', ')}.`,
    ].join('\n');
}

export async function smartOrganizeTabs({ ungroupedTabs, existingGroups = [], signal } = {}) {
    const capped = ungroupedTabs.slice(0, MAX_TABS);
    const skippedTabIds = ungroupedTabs.slice(MAX_TABS).map((t) => t.tabId);
    const indexToTabId = new Map(capped.map((t, i) => [i + 1, t.tabId]));
    const existingIds = new Set((existingGroups || []).map((g) => g.id));

    const session = await createAISession({
        systemPrompt: 'You group browser tabs by topic. Group names are short, specific, Title Case, no quotes or emojis.',
        temperature: 0.7,
        topK: 3,
        ...(signal ? { signal } : {}),
    });

    let raw;
    try {
        raw = await promptForJSON(session, buildOrganizePrompt({ ungroupedTabs: capped, existingGroups }), PLAN_SCHEMA, signal);
    } finally {
        session.destroy();
    }

    const placed = new Set();
    const newGroups = [];
    const additions = [];
    let colorCursor = 0;
    const nextColor = (c) => (GROUP_COLORS.includes(c) ? c : GROUP_COLORS[colorCursor++ % GROUP_COLORS.length]);

    for (const g of raw.groups || []) {
        const tabIds = (g.tabIndexes || [])
            .map((idx) => indexToTabId.get(idx))
            .filter((id) => id !== undefined && !placed.has(id));
        if (tabIds.length === 0) continue;
        tabIds.forEach((id) => placed.add(id));

        if (g.existingGroupId != null && existingIds.has(g.existingGroupId)) {
            additions.push({ groupId: g.existingGroupId, tabIds });
        } else {
            newGroups.push({ name: (g.name || 'Group').slice(0, MAX_NAME_LENGTH), color: nextColor(g.color), tabIds });
        }
    }

    // Anything in the capped set the model didn't place goes into "Other".
    const leftover = capped.map((t) => t.tabId).filter((id) => !placed.has(id));
    if (leftover.length > 0) {
        const existingOther = newGroups.find((g) => g.name === 'Other');
        if (existingOther) existingOther.tabIds.push(...leftover);
        else newGroups.push({ name: 'Other', color: nextColor('grey'), tabIds: leftover });
    }

    return { newGroups, additions, skippedTabIds };
}
