import { isSharedFolder, isReadOnlySharedFolder } from './sharedFolderUtils';

/**
 * Pure builder for FolderContainer's context-menu items. Kept free of icons
 * (FolderContainer attaches those) and free of React/DOM so the share/leave/
 * unshare/delete gating logic is unit-testable in isolation.
 *
 * @param {object} params
 * @param {object} params.folder - The folder record (may carry a `shared` marker).
 * @param {Function} params.onShare - Opens the Share modal.
 * @param {Function} params.onDelete - Deletes the (non-shared) folder.
 * @param {Function} params.onLeave - Leaves a shared folder the caller is a member of.
 * @param {Function} params.onUnshare - Stops sharing a folder the caller owns.
 * @param {boolean} params.isPro - Whether the current user has Tabox Pro.
 * @param {Array} [params.existingItems] - The folder's other menu items (export,
 *   duplicate, copy-folder-urls, stop-tracking-folder), in `{ id, text, icon,
 *   action, className, condition }` shape, minus the old inline `delete` entry.
 * @returns {Array} Menu items in the same shape, already filtered by `condition`.
 */
export function buildFolderMenuItems({ folder, onShare, onDelete, onLeave, onUnshare, isPro, existingItems = [] }) {
  const shared = isSharedFolder(folder);
  const readOnly = isReadOnlySharedFolder(folder);
  const isOwner = folder?.shared?.role === 'owner';
  const isMember = shared && !isOwner;
  return [
    {
      id: 'share',
      text: shared && isOwner ? 'Manage Sharing…' : 'Share…',
      action: onShare,
      condition: !isMember,
      proBadge: !isPro,
    },
    ...existingItems
      .map((item) => (readOnly && ['delete', 'stop-tracking-folder'].includes(item.id)
        ? { ...item, condition: false }
        : item))
      .filter((i) => !(shared && i.id === 'delete' && !isOwner)),
    { id: 'unshare', text: 'Stop Sharing (keep my copy)', action: onUnshare, condition: isOwner, className: 'danger' },
    { id: 'leave-shared', text: 'Leave Shared Folder', action: onLeave, condition: isMember, className: 'danger' },
    { id: 'delete', text: 'Delete Folder', action: onDelete, condition: !shared, className: 'danger' },
  ].filter((i) => i.condition !== false);
}
