import TaboxGroupItem from './model/TaboxGroupItem';
import { browser } from '../static/globals';

export function downloadTextFile(text, filename) {
  // Downloads a text file
  const element = document.createElement("a");
  const file = new Blob([text], { type: 'text/plain' });
  element.href = URL.createObjectURL(file);
  element.download = `${filename}.txt`;
  document.body.appendChild(element);
  element.click();
}

export function applyUid(item) {
  // Applies a unique id to all tabs and groups in a TaboxGroupItem
  if (!item || !('tabs' in item) || item.tabs.length === 0) return item;
  console.log('applying uid to collection', item.name);
  let tabs = [...item.tabs];
  let chromeGroups = item.chromeGroups ? [...item.chromeGroups] : [];
  tabs.forEach((tab) => {
    const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    tab.uid = uid;
  });
  if (chromeGroups.length > 0) {
    chromeGroups.forEach((group) => {
      const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const groupUid = uid;
      group.uid = groupUid;
      tabs = tabs.map(t => (t.groupId === group.id ? { ...t, groupUid: groupUid } : t));
    });
  }
  return new TaboxGroupItem(item.name, tabs, chromeGroups, item.color, item.createdOn, item.window);
}

export async function getCurrentTabsAndGroups(title, onlyHighlighted = false) {
  let tabQueryProperties = { currentWindow: true };
  const { chkIgnorePinned } = await browser.storage.local.get('chkIgnorePinned');
  if (onlyHighlighted) tabQueryProperties.highlighted = true;
  if (chkIgnorePinned) tabQueryProperties.pinned = false;
  let tabs = await browser.tabs.query(tabQueryProperties);
  const window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
  delete window.tabs;
  let allChromeGroups = await browser.tabGroups.query({});
  if (allChromeGroups && allChromeGroups.length > 0) {
    const groupIds = [...new Set(tabs.filter(({ groupId }) => groupId > -1).map((t) => t.groupId))];
    allChromeGroups = allChromeGroups.filter(({ id }) => groupIds.includes(id));
  }
  const newItem = new TaboxGroupItem(title, tabs, allChromeGroups, null, null, window);
  return applyUid(newItem);
}