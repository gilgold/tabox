/**
 * Group counting helper.
 *
 * The displayed "N groups" label must match what the user actually sees when a
 * collection is expanded. The expanded view (see buildTopLevelItems in
 * collectionDragUtils) only renders a tab group when it has at least one tab
 * referencing it via `groupUid`. Counting `chromeGroups.length` directly is
 * wrong because orphaned groups (groups whose tabs were all removed — e.g. by
 * the duplicate-sweep / move flows) can linger in `chromeGroups` while no tab
 * points at them. Those orphaned groups are intentionally kept around so undo
 * can re-attach restored tabs, but they must NOT be counted.
 *
 * @param {{tabs?: Array, chromeGroups?: Array}} collection
 * @returns {number} number of groups that contain at least one tab
 */
export const countNonEmptyGroups = (collection) => {
  const groups = Array.isArray(collection?.chromeGroups) ? collection.chromeGroups : [];
  if (groups.length === 0) return 0;
  const tabs = Array.isArray(collection?.tabs) ? collection.tabs : [];
  const groupUidsWithTabs = new Set(
    tabs.filter((tab) => tab && tab.groupUid).map((tab) => tab.groupUid)
  );
  return groups.filter((group) => group && groupUidsWithTabs.has(group.uid)).length;
};
