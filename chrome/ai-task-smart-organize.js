// chrome/ai-task-smart-organize.js
// AI task: plan tab grouping for a window. Planning only — the existing
// smartOrganizeApply message performs the chrome.tabGroups mutation.
(() => {
const def = {
    id: 'smart-organize',
    async run({ ctx, params, report }) {
        const { planners, client, readWindow } = ctx;
        await report({ progress: 10, currentLabel: 'Step 1 of 3: Reading tabs…' });
        const { ungroupedTabs, existingGroups } = await readWindow(params.windowId);
        const capped = ungroupedTabs.slice(0, planners.ORGANIZE_MAX_TABS);
        const skippedTabIds = ungroupedTabs.slice(planners.ORGANIZE_MAX_TABS).map((t) => t.tabId);
        await report({ progress: 25, currentLabel: 'Step 2 of 3: Asking AI to group tabs…' });
        const session = await client.createAISession({ systemPrompt: 'You group browser tabs by topic. Group names are short, specific, Title Case, no quotes or emojis.', temperature: 0 });
        let raw;
        try {
            await report({ progress: 35, currentLabel: 'Step 2 of 3: Asking AI to group tabs…' });
            raw = await client.promptForJSON(session, planners.buildOrganizePrompt({ ungroupedTabs: capped, existingGroups }), planners.ORGANIZE_SCHEMA);
            await report({ progress: 85, currentLabel: 'Step 3 of 3: Preparing tab groups…' });
        }
        finally { session.destroy(); }
        const { newGroups, additions } = planners.normalizeOrganizePlan(raw, capped, existingGroups);
        const plan = { newGroups, additions, skippedTabIds };
        await report({ progress: 100, currentLabel: 'Step 3 of 3: Preparing tab groups…', total: capped.length, filed: capped.length, results: plan });
        return { summary: '', undo: null };
    },
    async undo() {},
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
