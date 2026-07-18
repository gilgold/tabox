// Regression test for the MV3 service-worker global-scope collision bug class.
//
// Background: chrome/background.js loads its helper files via importScripts(),
// which are CLASSIC scripts that all share ONE global scope (unlike ES modules,
// and unlike Jest's per-file require() scope). A top-level `const`/`let`/
// `function`/`class` declared in one imported file collides with the same
// identifier declared in another, and the collision throws a SyntaxError that
// aborts the *entire* worker load — e.g. background-utils.js declares
// `async function getAuthToken()` and shared-folders.js used to re-declare it
// via `const { getAuthToken } = ...`, which crashed the real worker but was
// invisible to Jest (each required module gets its own scope there).
//
// This file has two independent regression tests for that bug class:
//   1. A vm-based simulation that actually loads every importScripts() file,
//      in order, into ONE shared context — just like the real worker.
//   2. A static line-scan that asserts no two files declare the same
//      top-level identifier, independent of whether vm happens to catch it.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHROME_DIR = path.join(__dirname, '..', 'chrome');
const BACKGROUND_PATH = path.join(CHROME_DIR, 'background.js');

// --- Shared helper: pull the importScripts() file list, in load order, out of
// background.js itself, so this test can never drift from the real load order. ---
function getImportScriptsOrder() {
    const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
    const re = /importScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
    const files = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        files.push(m[1]);
    }
    return files;
}

// Vendor/minified files: not present in chrome/ at all until webpack copies
// them in from node_modules at build time (see webpack.js), and not authored
// by us — skip loading them into the vm and exempt them from the static scan.
const VENDOR_FILE_EXEMPTIONS = new Set(['browser-polyfill.min.js']);

// --- Test 1: vm-based WorkerGlobalScope simulation -------------------------

// Any property access on this proxy returns another callable/awaitable proxy,
// so unstubbed chrome/browser APIs (chrome.tabGroups.move, browser.windows.get,
// etc.) never throw "cannot read property of undefined" during load. Calling
// it, `new`-ing it, or awaiting it (no `then`, so `await` just resolves to the
// proxy itself) all silently succeed — good enough since none of the imported
// files invoke these APIs synchronously at load time; they only reference them
// inside function bodies that this test never calls.
function makeAutoProxy() {
    const target = function AutoProxyTarget() {};
    const handler = {
        get(t, prop) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally' || prop === Symbol.toPrimitive || prop === Symbol.iterator) {
                return undefined;
            }
            if (!(prop in t)) {
                t[prop] = makeAutoProxy();
            }
            return t[prop];
        },
        apply() {
            return makeAutoProxy();
        },
        construct() {
            return makeAutoProxy();
        },
    };
    return new Proxy(target, handler);
}

function buildWorkerSandbox() {
    const browserStub = {
        storage: {
            local: {
                get: () => Promise.resolve({}),
                set: () => Promise.resolve(),
                remove: () => Promise.resolve(),
            },
            onChanged: { addListener() {}, removeListener() {} },
        },
        runtime: {
            sendMessage: () => Promise.resolve(),
            onMessage: { addListener() {}, removeListener() {} },
            onInstalled: { addListener() {} },
            onStartup: { addListener() {} },
            getURL: (p) => p,
        },
        alarms: {
            create: () => Promise.resolve(),
            getAll: () => Promise.resolve([]),
            onAlarm: { addListener() {} },
        },
    };

    // Fall back to the auto-proxy for anything not explicitly stubbed above
    // (tabs, tabGroups, contextMenus, commands, windows, action, ...).
    const deepAutoFallback = (obj) => new Proxy(obj, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return makeAutoProxy();
        },
    });

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        URL,
        URLSearchParams,
        crypto: globalThis.crypto,
        fetch: () => Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
        // The real worker's importScripts loads files synchronously; the files
        // under test never call it themselves (only background.js does, and
        // background.js itself is intentionally NOT loaded here), so a no-op
        // is sufficient.
        importScripts: () => {},
        // Deliberately no `require` / `module` — this must exercise the plain
        // classic-script branch of each file's dual require/globalThis pattern,
        // exactly like the real service worker.
    };
    sandbox.browser = deepAutoFallback(browserStub);
    sandbox.chrome = sandbox.browser;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    return sandbox;
}

describe('background.js importScripts files share one WorkerGlobalScope', () => {
    test('every file loads without a top-level redeclaration (or other) SyntaxError', () => {
        const files = getImportScriptsOrder().filter((f) => !VENDOR_FILE_EXEMPTIONS.has(f));
        expect(files.length).toBeGreaterThan(0);

        const sandbox = buildWorkerSandbox();
        const context = vm.createContext(sandbox);

        for (const file of files) {
            const filePath = path.join(CHROME_DIR, file);
            const source = fs.readFileSync(filePath, 'utf8');
            try {
                vm.runInContext(source, context, { filename: file });
            } catch (error) {
                throw new Error(
                    `Loading "${file}" into the shared worker scope failed: ${error.message}\n` +
                    'This means it collides with (or otherwise breaks after) a file loaded earlier ' +
                    'via importScripts in chrome/background.js — the real service worker would fail ' +
                    'to load entirely.'
                );
            }
        }
    });
});

// --- Test 2: static cross-file top-level identifier disjointness ----------

// Extracts top-level `const`/`let`/`function`/`class` (and `async function`)
// identifiers from a classic script, tracking actual brace-nesting depth
// rather than leading whitespace — this codebase wraps most files in a
// `(() => { ... })()` IIFE with zero-indented bodies, so a naive "column 0"
// heuristic would flag same-named locals inside two different IIFEs (e.g.
// `readState` in both ai-engine.js and duplicate-sweep.js) as false-positive
// collisions, even though closures keep them from ever touching the shared
// scope. Only names declared at actual depth 0 (directly in the file, not
// inside any `{...}`) can collide in the real worker, so that's what this
// scans for. This is still a heuristic (no real JS parser, so template
// literals / regex literals containing brace-like characters could in theory
// throw off the depth count) — the vm test above is the ground truth; this
// is a cheap, fast second signal that also documents *which* identifier
// collides and in which files.
function extractTopLevelIdentifiers(source) {
    const names = new Set();
    const declRe = /^(?:export\s+)?(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/;
    // Destructuring form: `const { getAuthToken, foo: bar } = something;` — this
    // is exactly the shape of the real bug (shared-folders.js re-declaring
    // background-utils.js's getAuthToken via destructure). Captures plain names
    // (`getAuthToken`) and renamed-alias targets (`bar` from `foo: bar`), which
    // is what actually gets bound in the shared scope.
    const destructureRe = /^(?:export\s+)?(?:const|let|var)\s*\{([^}]*)\}\s*=/;
    let depth = 0;
    const lines = source.split('\n');
    for (const rawLine of lines) {
        const line = rawLine;
        const trimmed = line.trim();
        // Skip pure comment lines so `// const foo` never counts.
        const isCommentOnly = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
        if (depth === 0 && !isCommentOnly) {
            const m = declRe.exec(line);
            if (m) {
                names.add(m[1] || m[2]);
            }
            const dm = destructureRe.exec(line);
            if (dm) {
                for (const part of dm[1].split(',')) {
                    const piece = part.trim();
                    if (!piece) continue;
                    const alias = piece.includes(':') ? piece.split(':')[1].trim() : piece;
                    const bare = alias.split('=')[0].trim(); // strip default value, e.g. `x = 1`
                    if (/^[A-Za-z_$][\w$]*$/.test(bare)) names.add(bare);
                }
            }
        }
        // Crude brace counter: strip string/template/regex literals is out of
        // scope for this heuristic; count braces in the line as-is. Good
        // enough for this codebase's simple, consistently-formatted files.
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth = Math.max(0, depth - 1);
        }
    }
    return names;
}

describe('no two importScripts files declare the same top-level identifier', () => {
    test('top-level const/let/function/class names are disjoint across files', () => {
        const files = getImportScriptsOrder().filter((f) => !VENDOR_FILE_EXEMPTIONS.has(f));
        const namesByFile = new Map();
        for (const file of files) {
            const source = fs.readFileSync(path.join(CHROME_DIR, file), 'utf8');
            namesByFile.set(file, extractTopLevelIdentifiers(source));
        }

        const collisions = [];
        for (let i = 0; i < files.length; i++) {
            for (let j = i + 1; j < files.length; j++) {
                const a = files[i];
                const b = files[j];
                const shared = [...namesByFile.get(a)].filter((n) => namesByFile.get(b).has(n));
                if (shared.length) {
                    collisions.push(`${a} <-> ${b}: ${shared.join(', ')}`);
                }
            }
        }

        expect(collisions).toEqual([]);
    });
});
