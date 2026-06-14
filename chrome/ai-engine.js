// chrome/ai-engine.js
// Generic, task-agnostic runner. Owns the aiTaskState lifecycle and progress
// reporting; delegates all domain logic to the registered task. Adding a new
// task NEVER requires editing this file.
(() => {
const AI_TASK_STATE_KEY = 'aiTaskState';
function localArea() { return (globalThis.browser || globalThis.chrome).storage.local; }
async function readState() { return (await localArea().get(AI_TASK_STATE_KEY))[AI_TASK_STATE_KEY] || {}; }
let _writeChain = Promise.resolve();
function writeState(patch) {
    // Serialize read-merge-write so overlapping report() calls from a task can't
    // clobber each other (progress counters update in tight loops). One AI task
    // runs at a time, so a single module-level chain is sufficient.
    _writeChain = _writeChain.then(async () => {
        const cur = await readState();
        await localArea().set({ [AI_TASK_STATE_KEY]: { ...cur, ...patch } });
    });
    return _writeChain;
}
async function clearState() { await localArea().remove(AI_TASK_STATE_KEY); }

function createEngine({ registry, ctx }) {
    async function runTask({ id, params = {}, signal }) {
        const def = registry.getTask(id);
        if (!def) { await writeState({ type: id, status: 'error', summary: `Unknown AI task "${id}"`, finishedAt: Date.now() }); return await readState(); }
        // Full reset (not a merge) — intentionally bypasses writeState.
        await localArea().set({ [AI_TASK_STATE_KEY]: { taskId: `${id}-${Date.now()}`, type: id, status: 'running', filed: 0, total: 0, results: [], skipped: [], undo: null, cancelRequested: false, startedAt: Date.now() } });
        const report = (patch) => writeState(patch);
        const isCancelled = async () => signal?.aborted || (await readState()).cancelRequested === true;
        try {
            if (await isCancelled()) { await writeState({ status: 'cancelled', finishedAt: Date.now() }); return await readState(); }
            const { summary = '', undo = null } = (await def.run({ ctx: { ...ctx, isCancelled }, params, signal, report })) || {};
            // A task may also self-report status:'cancelled'; either source marks the run cancelled.
            const cancelled = (await readState()).status === 'cancelled' || (await isCancelled());
            await writeState({ status: cancelled ? 'cancelled' : 'done', summary, undo, finishedAt: Date.now() });
        } catch (e) {
            if (e && e.name === 'AbortError') await writeState({ status: 'cancelled', finishedAt: Date.now() });
            else { console.error(`Tabox AI task "${id}" failed:`, e); await writeState({ status: 'error', summary: (e && e.message) || 'AI task failed', finishedAt: Date.now() }); }
        }
        return await readState();
    }
    async function undoLast() {
        const snapshot = (await readState()).undo;
        if (!snapshot || !snapshot.task) return;
        const def = registry.getTask(snapshot.task);
        if (def && typeof def.undo === 'function') await def.undo({ ctx, snapshot });
        await clearState();
    }
    return { runTask, undoLast };
}

const api = { createEngine, AI_TASK_STATE_KEY };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxAIEngine = api;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
