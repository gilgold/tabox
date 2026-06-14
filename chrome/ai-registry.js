// chrome/ai-registry.js
// The AI-task extension point. Each chrome/ai-task-*.js file calls register()
// at load. The engine consumes getTask/allTasks. Nothing here knows about any
// specific task.
(() => {
const tasks = new Map();
function register(def) {
    if (!def || !def.id || typeof def.run !== 'function') throw new Error('AI task def needs {id, run}');
    tasks.set(def.id, def);
    return def;
}
function getTask(id) { return tasks.get(id) || null; }
function allTasks() { return Array.from(tasks.values()); }
function _reset() { tasks.clear(); } // test-only

const api = { register, getTask, allTasks, _reset };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxAIRegistry = api;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
