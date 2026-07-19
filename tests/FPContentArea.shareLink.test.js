// Parity guard: the full-page collection card right-click menu is hand-rolled
// in FPContentArea (it does NOT use createCollectionMenuItems), so shared-menu
// additions silently miss it. This caught the Share-via-Link gap once already.
// Follows the file-content test precedent of FPFullPageDesign.test.js — there
// is no behavioral harness for FPContentArea's portal menus.
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPContentArea.js'), 'utf8');

test('collection card right-click menu includes Share via Link', () => {
    const menuStart = source.indexOf('cardCtxMenu && createPortal');
    expect(menuStart).toBeGreaterThan(-1);
    const menuEnd = source.indexOf('folderCtxMenu && createPortal', menuStart);
    const cardMenu = source.slice(menuStart, menuEnd);
    expect(cardMenu).toContain('Share via Link');
    expect(cardMenu).toContain('setShareCollectionLink');
});

test('share-link action opens the shared modal atom (not a local implementation)', () => {
    expect(source).toContain("shareCollectionLinkModalState");
});
