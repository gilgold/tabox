// Installs a stateful browser.storage.local backed by an in-memory object.
// The repo's jest.setup.js provides only a minimal mock. Returns a reset() fn.
function installStatefulLocalStorage() {
  let store = {};
  browser.storage.local.get = jest.fn(async (keys) => {
    if (keys === null || keys === undefined) return { ...store };
    if (typeof keys === 'string') return { [keys]: store[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
    return Object.fromEntries(Object.keys(keys).map((k) => [k, store[k]]));
  });
  browser.storage.local.set = jest.fn(async (payload) => { Object.assign(store, payload); });
  browser.storage.local.remove = jest.fn(async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); });
  browser.storage.local.clear = jest.fn(async () => { store = {}; });
  return { reset: () => { store = {}; } };
}
module.exports = { installStatefulLocalStorage };
