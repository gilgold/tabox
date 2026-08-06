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
// Route cancellation through the same serialized write chain as report(), so a
// running task's in-flight report() (read-merge-write) can't clobber the flag
// back to false. Bypassing writeState here would reintroduce that race.
async function requestCancel() { await writeState({ cancelRequested: true }); }
// Recover a stuck 'running' state whose owning service worker was discarded
// mid-run (MV3): with no live worker there's nothing to write the terminal
// status, so the popup would reattach to a dead run forever. Only touches a
// running state — a genuinely terminal state is left as-is. Merges through the
// write chain so `type`/`results` survive for the modal.
async function finalizeInterrupted({ status = 'error', summary } = {}) {
    const cur = await readState();
    if (cur.status !== 'running') return cur;
    await writeState({
        status,
        summary: summary != null ? summary : 'Tabox AI stopped unexpectedly. Please try again.',
        finishedAt: Date.now(),
        cancelRequested: false,
    });
    return await readState();
}

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
    async function undoItems({ uids }) {
        // Safe read+write: undoItems runs after task completion (no report() in flight), and the popup serializes undo dispatch (it disables all undo controls while one revert is in flight), so no concurrent undoItems either.
        const state = await readState();
        const snapshot = state.undo;
        if (!snapshot || !snapshot.task || !Array.isArray(uids) || uids.length === 0) return;
        const def = registry.getTask(snapshot.task);
        if (!def || typeof def.undoItems !== 'function') return;
        await def.undoItems({ ctx, snapshot, uids });
        const uidSet = new Set(uids);
        const remaining = (snapshot.renames || []).filter((r) => !uidSet.has(r.uid));
        const results = (state.results || []).map((r) => (uidSet.has(r.uid) ? { ...r, reverted: true } : r));
        await writeState({ results, undo: remaining.length ? { ...snapshot, renames: remaining } : null });
    }
    return { runTask, undoLast, undoItems };
}

const api = { createEngine, requestCancel, finalizeInterrupted, AI_TASK_STATE_KEY };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxAIEngine = api;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
