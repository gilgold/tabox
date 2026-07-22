// Parity guard: the full-page collection card right-click menu must be built
// from the shared createCollectionMenuItems builder (the same one the popup
// uses), so shared-menu additions can never silently miss it. Its Share via
// Link entry must open the shared modal atom. Follows the file-content test
// precedent of FPFullPageDesign.test.js — there is no behavioral harness for
// FPContentArea's portal menus.
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPContentArea.js'), 'utf8');

test('collection card right-click menu is built from the shared createCollectionMenuItems builder', () => {
    const menuStart = source.indexOf('cardCtxMenu && (');
    expect(menuStart).toBeGreaterThan(-1);
    const menuEnd = source.indexOf('folderCtxMenu && (', menuStart);
    const cardMenu = source.slice(menuStart, menuEnd);
    expect(cardMenu).toContain('createCollectionMenuItems');
    expect(cardMenu).toContain('onShareLink');
    expect(cardMenu).toContain('setShareCollectionLink');
});

test('folder right-click menu is built from the shared createFolderMenuItems builder', () => {
    const menuStart = source.indexOf('folderCtxMenu && (');
    expect(menuStart).toBeGreaterThan(-1);
    const folderMenu = source.slice(menuStart);
    expect(folderMenu).toContain('createFolderMenuItems');
});

test('share-link action opens the shared modal atom (not a local implementation)', () => {
    expect(source).toContain("shareCollectionLinkModalState");
});
