// Cross-layer multi-device test harness for Shared Folders.
//
// Loads the REAL client engine (chrome/shared-folders.js) via Node's
// createRequire + a require-cache injection for its two dependencies
// (./background-utils and ./pro-config), wires its `fetch()` calls into the
// REAL worker (server/src/index.js's default export) against a REAL
// node:sqlite-backed D1 mock (server/test/helpers/d1Mock.js), and lets a
// test simulate any number of independent "devices" — each with its own
// isolated in-memory browser.storage.local and its own identity/token.
//
// Approach notes (see CLAUDE.md / task brief for why):
//   - vitest (not jest) was used: server/test lives in native ESM, and the
//     worker + d1 mock are ESM modules — vitest's Node runtime lets us
//     `createRequire` the classic-script client module directly, no
//     transpilation tricks needed. Verified working with a spike before
//     committing to this design (see report).
//   - chrome/shared-folders.js only reads two things from
//     require('./background-utils'): STORAGE_KEYS and getAuthToken. Rather
//     than requiring the real 2700-line background-utils.js (which pulls in
//     live Google-OAuth network calls via getAuthToken/getNewAccessToken),
//     we inject a minimal fake module into the require cache at its resolved
//     path. require('./pro-config') is left as the REAL file — it only
//     exports a base-URL string, and every fetch() the client makes is
//     already intercepted below, so the real URL value is inert.
//   - chrome/shared-folders.js is a singleton with module-level mutable state
//     (the `storageChain` mutex promise and the `sharedSyncInFlight`
//     re-entrancy guard). We do NOT try to reset that state between devices
//     mid-scenario: instead every device "turn" is fully awaited to
//     completion before the next device's turn begins (see `asDevice`
//     below), which is both realistic (the real protocol is polling-based,
//     never truly concurrent within one process) and keeps the shared mutex
//     harmless. Each `it(...)` test DOES get a fully fresh module instance
//     (see `createHarness`), so state never leaks *between* tests.
//   - `browser` and `fetch` are true ambient globals inside
//     chrome/shared-folders.js (bare identifiers, not `require`d bindings),
//     so swapping `globalThis.browser` before each device's turn correctly
//     redirects storage reads/writes without needing per-device module
//     copies.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_DIR = path.resolve(__dirname, '..', '..', '..', 'chrome');
const SHARED_FOLDERS_ENTRY = path.join(CHROME_DIR, 'shared-folders.js');

const nodeRequire = createRequire(SHARED_FOLDERS_ENTRY);

// ---- in-memory browser.storage.local mock -------------------------------

export function makeBrowserMock() {
  const store = {};
  return {
    _store: store,
    storage: {
      local: {
        async get(keys) {
          if (keys === undefined || keys === null) return { ...store };
          const names = typeof keys === 'string' ? [keys]
            : Array.isArray(keys) ? keys
            : Object.keys(keys);
          const out = {};
          for (const k of names) {
            if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
          }
          return out;
        },
        async set(obj) {
          Object.assign(store, obj);
        },
        async remove(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          for (const k of names) delete store[k];
        },
      },
    },
    notifications: {
      create: async () => {},
    },
  };
}

// ---- device -----------------------------------------------------------

let deviceCounter = 0;

export function makeDevice({ label, googleId, email, token, seed = {} } = {}) {
  deviceCounter += 1;
  const browserMock = makeBrowserMock();
  Object.assign(browserMock._store, { googleUser: { emailAddress: email } }, seed);
  return {
    id: `device-${deviceCounter}`,
    label: label || `device-${deviceCounter}`,
    googleId,
    email,
    token,
    browserMock,
  };
}

// ---- harness ------------------------------------------------------------

export function makeKV(store = {}) {
  return {
    _store: store,
    async get(k) { return (k in store) ? JSON.stringify(store[k]) : null; },
    async put(k, v) { store[k] = JSON.parse(v); },
  };
}

/**
 * @param {object} opts
 * @param {object} opts.db - a fresh makeDB() instance (server/test/helpers/d1Mock.js)
 * @param {object} [opts.kvStore] - backing object for the ENTITLEMENTS KV mock
 * @param {Record<string,{googleId:string,email:string}>} opts.identities - token -> identity, for the Google-auth mock
 */
export function createHarness({ db, kvStore = {}, identities = {} }) {
  const bgUtilsPath = nodeRequire.resolve('./background-utils');
  const sharedFoldersPath = nodeRequire.resolve('./shared-folders');

  // Force a brand-new module instance for THIS harness (isolates module-level
  // mutex/in-flight-guard state between tests; see file-header notes).
  delete nodeRequire.cache[sharedFoldersPath];

  const active = { device: null };

  // Minimal stand-in for background-utils.js: shared-folders.js only reads
  // STORAGE_KEYS and getAuthToken from it. getAuthToken resolves to whichever
  // device is "active" at call time (see asDevice) — safe because every
  // device turn is awaited to completion before the next begins.
  nodeRequire.cache[bgUtilsPath] = {
    id: bgUtilsPath,
    filename: bgUtilsPath,
    loaded: true,
    exports: {
      STORAGE_KEYS: {
        DELETED_COLLECTION_TOMBSTONES: 'deleted_collection_tombstones',
        DELETED_FOLDER_TOMBSTONES: 'deleted_folder_tombstones',
      },
      getAuthToken: async () => (active.device ? active.device.token : null),
    },
  };

  const client = nodeRequire(sharedFoldersPath);

  const env = {
    GOOGLE_CLIENT_ID: 'cid',
    JWT_SECRET: 's',
    ENTITLEMENTS: makeKV(kvStore),
    SHARED_DB: db,
  };

  const fetchLog = [];

  // ONE fetch dispatcher handles both directions:
  //  - client -> our worker (SHARED_API_BASE + path): logged, routed to worker.fetch
  //  - worker's authenticate() -> Google tokeninfo/drive-about: resolved via `identities`
  // (mirrors sharedRoutes.test.js's mockGoogle, combined with routing to worker.fetch
  // so the real client's fetch() calls hit the real router end-to-end.)
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('tokeninfo') || urlStr.includes('googleapis.com/drive')) {
      const token = urlStr.includes('tokeninfo')
        ? new URL(urlStr).searchParams.get('access_token')
        : (opts?.headers?.Authorization || '').replace('Bearer ', '');
      const id = identities[token];
      if (!id) return { ok: false };
      if (urlStr.includes('tokeninfo')) return { ok: true, json: async () => ({ aud: env.GOOGLE_CLIENT_ID }) };
      return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
    }
    const request = new Request(url, opts);
    const entry = {
      url: urlStr,
      pathname: new URL(urlStr).pathname,
      method: (opts && opts.method) || 'GET',
      device: active.device ? active.device.label : null,
      bodyRaw: opts && opts.body,
    };
    fetchLog.push(entry);
    return worker.fetch(request, env);
  };

  /** Runs `fn` with `globalThis.browser` pointed at `device`'s storage and
   * getAuthToken() resolving to `device`'s token. Always awaited fully before
   * returning — callers must not run two of these concurrently (Promise.all),
   * only sequentially (see file-header notes on the module-level mutex). */
  async function asDevice(device, fn) {
    active.device = device;
    globalThis.browser = device.browserMock;
    try {
      return await fn(client);
    } finally {
      // Leave active.device set (harmless) — next asDevice() call overwrites it.
    }
  }

  function putCollectionCalls(uid) {
    return fetchLog.filter((e) => e.method === 'PUT' && e.pathname.endsWith(`/collections/${uid}`));
  }
  function deleteCollectionCalls(uid) {
    return fetchLog.filter((e) => e.method === 'DELETE' && e.pathname.endsWith(`/collections/${uid}`));
  }

  return { client, env, fetchLog, asDevice, putCollectionCalls, deleteCollectionCalls };
}

export { worker };
