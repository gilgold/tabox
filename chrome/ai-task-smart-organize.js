// chrome/ai-task-smart-organize.js
// AI task: plan tab grouping for a window. Planning only — the existing
// smartOrganizeApply message performs the chrome.tabGroups mutation.
(() => {
const def = {
    id: 'smart-organize',
    async run({ ctx, params, report }) {
        const { planners, client, readWindow } = ctx;
        const { ungroupedTabs, existingGroups } = await readWindow(params.windowId);
        const capped = ungroupedTabs.slice(0, planners.ORGANIZE_MAX_TABS);
        const skippedTabIds = ungroupedTabs.slice(planners.ORGANIZE_MAX_TABS).map((t) => t.tabId);
        const session = await client.createAISession({ systemPrompt: 'You group browser tabs by topic. Group names are short, specific, Title Case, no quotes or emojis.', temperature: 0.7, topK: 3 });
        let raw;
        try { raw = await client.promptForJSON(session, planners.buildOrganizePrompt({ ungroupedTabs: capped, existingGroups }), planners.ORGANIZE_SCHEMA); }
        finally { session.destroy(); }
        const { newGroups, additions } = planners.normalizeOrganizePlan(raw, capped, existingGroups);
        const plan = { newGroups, additions, skippedTabIds };
        await report({ total: capped.length, filed: capped.length, results: plan });
        return { summary: '', undo: null };
    },
    async undo() {},
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
