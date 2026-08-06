/** @jest-environment jsdom */
import { buildFolderMenuItems } from '../app/utils/folderMenuItems';

const base = { onShare: jest.fn(), onDelete: jest.fn(), onLeave: jest.fn(), onUnshare: jest.fn(), isPro: true };

test('normal folder: has Share…, Delete, no Leave', () => {
  const items = buildFolderMenuItems({ folder: { uid: 'f1', name: 'A' }, ...base });
  const ids = items.filter((i) => i.condition !== false).map((i) => i.id);
  expect(ids).toContain('share');
  expect(ids).toContain('delete');
  expect(ids).not.toContain('leave-shared');
});

test('normal folder: marks Share… with a Pro badge only for non-Pro users', () => {
  const freeItems = buildFolderMenuItems({
    folder: { uid: 'f1', name: 'A' },
    ...base,
    isPro: false,
  });
  const proItems = buildFolderMenuItems({
    folder: { uid: 'f1', name: 'A' },
    ...base,
    isPro: true,
  });

  expect(freeItems.find((item) => item.id === 'share')).toEqual(
    expect.objectContaining({ text: 'Share…', proBadge: true }),
  );
  expect(proItems.find((item) => item.id === 'share')).toEqual(
    expect.objectContaining({ text: 'Share…', proBadge: false }),
  );
});

test('owner of shared folder: Share… (manage) + Unshare instead of plain delete flow', () => {
  const items = buildFolderMenuItems({ folder: { uid: 'f1', shared: { folderId: 'f1', role: 'owner' } }, ...base });
  const ids = items.filter((i) => i.condition !== false).map((i) => i.id);
  expect(ids).toContain('share');
  expect(ids).toContain('unshare');
});

test('read-only member: no delete/share mutations, has Leave', () => {
  const items = buildFolderMenuItems({ folder: { uid: 'f1', shared: { folderId: 'f1', role: 'read' } }, ...base });
  const ids = items.filter((i) => i.condition !== false).map((i) => i.id);
  expect(ids).toContain('leave-shared');
  expect(ids).not.toContain('delete');
  expect(ids).not.toContain('share');
});

test('write member: no Share/Unshare, keeps export/duplicate, has Leave', () => {
  const existingItems = [
    { id: 'export', text: 'Export Folder', action: jest.fn(), className: '', condition: true },
    { id: 'duplicate', text: 'Duplicate Folder', action: jest.fn(), className: '', condition: true },
    { id: 'stop-tracking-folder', text: 'Stop Auto Tracking Folder', action: jest.fn(), className: '', condition: true },
  ];
  const items = buildFolderMenuItems({
    folder: { uid: 'f1', shared: { folderId: 'f1', role: 'write' } },
    ...base,
    existingItems,
  });
  const ids = items.filter((i) => i.condition !== false).map((i) => i.id);
  expect(ids).not.toContain('share');
  expect(ids).not.toContain('unshare');
  expect(ids).not.toContain('delete');
  expect(ids).toContain('leave-shared');
  expect(ids).toContain('export');
  expect(ids).toContain('duplicate');
  expect(ids).toContain('stop-tracking-folder');
});

test('read-only member: stop-tracking-folder is blocked even if otherwise applicable', () => {
  const existingItems = [
    { id: 'export', text: 'Export Folder', action: jest.fn(), className: '', condition: true },
    { id: 'stop-tracking-folder', text: 'Stop Auto Tracking Folder', action: jest.fn(), className: '', condition: true },
  ];
  const items = buildFolderMenuItems({
    folder: { uid: 'f1', shared: { folderId: 'f1', role: 'read' } },
    ...base,
    existingItems,
  });
  const ids = items.filter((i) => i.condition !== false).map((i) => i.id);
  expect(ids).not.toContain('stop-tracking-folder');
  expect(ids).toContain('export');
});
