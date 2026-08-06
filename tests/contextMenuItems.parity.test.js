// Popup ↔ full-page context-menu parity: both views must build their menus
// from the shared builders in app/utils/contextMenuItems.js.
import fs from 'fs';
import path from 'path';
import { createCollectionMenuItems, createFolderMenuItems } from '../app/utils/contextMenuItems';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const visibleIds = (items) => items.filter((i) => i.condition !== false).map((i) => i.id);

describe('createCollectionMenuItems open/focus entries', () => {
    test('shows Open Tabs (not Focus Window) for non-tracked collections', () => {
        const ids = visibleIds(createCollectionMenuItems({
            isAutoUpdate: false,
            onOpenTabs: jest.fn(),
            onFocusWindow: jest.fn(),
        }));
        expect(ids).toContain('open-tabs');
        expect(ids).not.toContain('focus-window');
    });

    test('shows Focus Window (not Open Tabs) for auto-updating collections', () => {
        const ids = visibleIds(createCollectionMenuItems({
            isAutoUpdate: true,
            onOpenTabs: jest.fn(),
            onFocusWindow: jest.fn(),
        }));
        expect(ids).toContain('focus-window');
        expect(ids).not.toContain('open-tabs');
    });

    test('hides open/focus entries when no handlers are provided', () => {
        const ids = visibleIds(createCollectionMenuItems({}));
        expect(ids).not.toContain('open-tabs');
        expect(ids).not.toContain('focus-window');
    });

    test('tags items with divider groups (open / main / danger)', () => {
        const items = createCollectionMenuItems({ onOpenTabs: jest.fn() });
        expect(items.find((i) => i.id === 'open-tabs').group).toBe('open');
        expect(items.find((i) => i.id === 'update').group).toBe('main');
        expect(items.find((i) => i.id === 'delete').group).toBe('danger');
    });
});

describe('createFolderMenuItems', () => {
    const handlers = {
        onOpenAll: jest.fn(),
        onEdit: jest.fn(),
        onExport: jest.fn(),
        onDuplicate: jest.fn(),
        onCopyUrls: jest.fn(),
        onStopTracking: jest.fn(),
        onShare: jest.fn(),
        onUnshare: jest.fn(),
        onLeave: jest.fn(),
        onDelete: jest.fn(),
    };

    test('normal folder gets the full-page canonical menu, in order', () => {
        const ids = visibleIds(createFolderMenuItems({ folder: { uid: 'f1', name: 'A' }, ...handlers }));
        expect(ids).toEqual(['share', 'open-all', 'edit', 'export', 'duplicate', 'copy-folder-urls', 'delete']);
    });

    test('stop-tracking-folder appears only when the folder has tracked collections', () => {
        const withTracked = visibleIds(createFolderMenuItems({
            folder: { uid: 'f1' }, ...handlers, hasTrackedCollections: true,
        }));
        expect(withTracked).toContain('stop-tracking-folder');
        const without = visibleIds(createFolderMenuItems({ folder: { uid: 'f1' }, ...handlers }));
        expect(without).not.toContain('stop-tracking-folder');
    });

    test('every item carries an icon and a divider group', () => {
        const items = createFolderMenuItems({
            folder: { uid: 'f1' }, ...handlers, hasTrackedCollections: true,
        });
        for (const item of items) {
            expect(item.icon).toBeTruthy();
            expect(['share', 'main', 'danger']).toContain(item.group);
        }
        expect(items.find((i) => i.id === 'share').group).toBe('share');
        expect(items.find((i) => i.id === 'delete').group).toBe('danger');
    });

    test('shared-permission gating still applies (read-only member)', () => {
        const ids = visibleIds(createFolderMenuItems({
            folder: { uid: 'f1', shared: { folderId: 'f1', role: 'read' } },
            ...handlers,
            hasTrackedCollections: true,
        }));
        expect(ids).toContain('leave-shared');
        expect(ids).not.toContain('share');
        expect(ids).not.toContain('delete');
        expect(ids).not.toContain('stop-tracking-folder');
    });
});

describe('all views build menus from the shared builders', () => {
    test.each([
        ['app/FolderContainer.js'],
        ['app/fullpage/FPSidebar.js'],
        ['app/fullpage/FPContentArea.js'],
    ])('%s uses createFolderMenuItems and no inline folder menu', (file) => {
        const source = read(file);
        expect(source).toContain('createFolderMenuItems');
        expect(source).not.toContain('buildFolderMenuItems');
    });

    test.each([
        ['app/CollectionListItem.js'],
        ['app/CollectionTile.js'],
        ['app/fullpage/FPContentArea.js'],
    ])('%s builds the collection menu with open/focus handlers', (file) => {
        const source = read(file);
        expect(source).toContain('createCollectionMenuItems');
        expect(source).toContain('onOpenTabs');
        expect(source).toContain('onFocusWindow');
    });
});
