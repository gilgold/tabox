const fs = require('fs');
const path = require('path');
const baseManifest = require('../chrome/manifest.json');
const { buildManifest, BACKGROUND_SCRIPTS } = require('../chrome/buildManifest');

describe('buildManifest', () => {
    test('chrome target returns the base manifest unchanged', () => {
        expect(buildManifest(baseManifest, 'chrome')).toEqual(baseManifest);
    });

    test('firefox target strips Chrome-only keys', () => {
        const ff = buildManifest(baseManifest, 'firefox');
        expect(ff.oauth2).toBeUndefined();
        expect(ff.key).toBeUndefined();
        expect(ff.minimum_chrome_version).toBeUndefined();
        expect(ff.externally_connectable).toBeUndefined();
    });

    test('firefox target swaps service worker for event-page scripts', () => {
        const ff = buildManifest(baseManifest, 'firefox');
        expect(ff.background.service_worker).toBeUndefined();
        expect(ff.background.scripts).toEqual([...BACKGROUND_SCRIPTS, 'background.js']);
        expect(ff.background.scripts[0]).toBe('browser-polyfill.min.js');
    });

    test('firefox target adds browser_specific_settings', () => {
        const ff = buildManifest(baseManifest, 'firefox');
        expect(ff.browser_specific_settings.gecko).toEqual({
            id: 'tabox@tabox.co',
            strict_min_version: '139.0',
            data_collection_permissions: { required: ['browsingActivity'] }
        });
    });

    test('firefox target drops unsupported permissions, keeps the rest in order', () => {
        const ff = buildManifest(baseManifest, 'firefox');
        expect(ff.permissions).not.toContain('system.display');
        expect(ff.permissions).toEqual(
            baseManifest.permissions.filter(p => p !== 'system.display')
        );
    });

    test('firefox transform does not mutate the base manifest object', () => {
        const before = JSON.stringify(baseManifest);
        buildManifest(baseManifest, 'firefox');
        expect(JSON.stringify(baseManifest)).toBe(before);
    });

    test('BACKGROUND_SCRIPTS matches the importScripts list in background.js', () => {
        const src = fs.readFileSync(path.join(__dirname, '../chrome/background.js'), 'utf8');
        const imported = [...src.matchAll(/importScripts\('([^']+)'\)/g)].map(m => m[1]);
        expect(imported).toEqual(BACKGROUND_SCRIPTS);
    });
});
