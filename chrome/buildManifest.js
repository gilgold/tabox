// Per-target manifest derivation. The Chrome manifest (chrome/manifest.json)
// stays the single source of truth; the Firefox manifest is derived from it
// at build time. Consumed by webpack.js and tests/buildManifest.test.js.

// Load order matters and must mirror the importScripts() block at the top of
// chrome/background.js exactly — tests/buildManifest.test.js enforces parity.
const BACKGROUND_SCRIPTS = [
    'browser-polyfill.min.js',
    'sync-session-state.js',
    'sync-transport.js',
    'sync-merge.js',
    'sync-apply.js',
    'sync-throttle.js',
    'pro-config.js',
    'background-utils.js',
    'push-client.js',
    'pro-entitlement.js',
    'shared-folders.js',
    'ai-client.js',
    'ai-planners.js',
    'ai-storage.js',
    'ai-registry.js',
    'ai-engine.js',
    'ai-task-auto-rename.js',
    'ai-task-auto-arrange.js',
    'ai-task-smart-organize.js',
    'duplicate-detect.js',
    'duplicate-sweep.js',
    'ai-task-duplicate-sweep.js',
    'split-collection.js',
    'ai-task-split-collection.js',
];

function buildManifest(base, target) {
    if (target !== 'firefox') return base;

    // Chrome-only keys Firefox rejects or ignores noisily.
    const {
        oauth2,                    // eslint-disable-line no-unused-vars
        key,                       // eslint-disable-line no-unused-vars
        minimum_chrome_version,    // eslint-disable-line no-unused-vars
        externally_connectable,    // eslint-disable-line no-unused-vars
        ...rest
    } = base;

    return {
        ...rest,
        background: {
            // Firefox MV3 runs event pages, not service workers.
            scripts: [...BACKGROUND_SCRIPTS, 'background.js'],
        },
        permissions: base.permissions.filter(p => p !== 'system.display'),
        browser_specific_settings: {
            gecko: {
                id: 'tabox@tabox.co',
                strict_min_version: '139.0',
                data_collection_permissions: { required: ['browsingActivity'] },
            },
        },
    };
}

module.exports = { buildManifest, BACKGROUND_SCRIPTS };
