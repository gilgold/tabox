import TaboxCollection from './model/TaboxCollection';
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
  // Applies a unique id to all tabs and groups in a TaboxCollection
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
      const groupUid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      group.uid = groupUid;
      tabs = tabs.map(t => (t.groupId === group.id ? { ...t, groupUid: groupUid } : t));
    });
  }
  return new TaboxCollection(item.name, tabs, chromeGroups, item.color, item.createdOn, item.window);
}

export async function getCurrentTabsAndGroups(title, forceOnlyHighlighted = false) {
  let tabQueryProperties = { currentWindow: true };
  const totalHighlighted = await browser.tabs.query({ highlighted: true, windowId: browser.windows.WINDOW_ID_CURRENT });
  const onlyHighlighted = forceOnlyHighlighted || totalHighlighted.length > 1;
  const { chkIgnorePinned } = await browser.storage.local.get('chkIgnorePinned');
  if (onlyHighlighted) tabQueryProperties.highlighted = true;
  if (chkIgnorePinned) tabQueryProperties.pinned = false;
  let tabs = await browser.tabs.query(tabQueryProperties);
  const window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
  delete window.tabs;
  let allChromeGroups;
  if (browser.tabGroups) {
    try {
      allChromeGroups = await browser.tabGroups.query({ windowId: window.id });
      if (allChromeGroups && allChromeGroups.length > 0) {
        const groupIds = [...new Set(tabs.filter(({ groupId }) => groupId > -1).map((t) => t.groupId))];
        allChromeGroups = allChromeGroups.filter(({ id }) => groupIds.includes(id));
      }
    } catch {
      allChromeGroups = [];
    }
  } else {
    allChromeGroups = [];
  }
  const newItem = new TaboxCollection(title, tabs, allChromeGroups, null, null, window);
  return applyUid(newItem);
}

export const colorChart = {
    'grey': '#54585d',
    'blue': '#1b68de',
    'red': '#d22c28',
    'yellow': '#fcd065',
    'green': '#21823d',
    'pink': '#fd80c2',
    'purple': '#872fdb',
    'cyan': '#6fd3e7'
  };

export const getColorCode = (name) => {
  if (!name) return name;
  const _name = name.toLowerCase();
  return (_name in colorChart) ? colorChart[_name] : name;
}

export const updateGroupAttribute = (group, attr, val, collection, updateCollection) => {
  let currentCollection = { ...collection };
  const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === group.uid);
  let chromeGroups = [...currentCollection.chromeGroups];
  let chromeGrp = { ...chromeGroups[grpIndex] }
  chromeGrp[attr] = val;
  chromeGroups[grpIndex] = chromeGrp;
  currentCollection.chromeGroups = chromeGroups;
  updateCollection(currentCollection);
}

export const getColorName = (value) => Object.keys(colorChart).find(key => colorChart[key] === value);
