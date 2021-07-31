import TaboxGroupItem from './model/TaboxGroupItem';
import { browser } from '../static/index';
import { uid } from 'react-uid';

const URL_SEPERATOR = '`';
const SETTING_SEPERATOR = '|';
const PINNED_TAB_INDICATOR = '*';

let lastValidated = 0;

export function convertOldStringToDataArray(oldDataString) {
  // Converts a given string of old tabox data into new json format
  let oldDataArray = oldDataString.split(SETTING_SEPERATOR);
  let newDataArray = [];
  oldDataArray.forEach((oldDataMember) => {
    let urlArray = oldDataMember.split(URL_SEPERATOR);
    let newTabsArray = [];
    urlArray.forEach((url, index) => {
      if (index === 0 || url === '') {
        return;
      }
      let tabObject = {
        url: '',
        pinned: false
      };
      const pinned = url.startsWith(PINNED_TAB_INDICATOR);
      if (pinned) {
        url = url.substring(1, url.length)
      }
      tabObject.url = url;
      tabObject.pinned = pinned;
      newTabsArray.push(tabObject);
    });
    const newDataItem = new TaboxGroupItem(urlArray[0], newTabsArray, null);
    newDataArray.push(newDataItem);
  });
  return newDataArray;
}

export async function convertOldDataToNewFormat() {
  // Checks local storage for the old "settings" data and if it exists, converts it to the new json format
  const { settings } = await browser.storage.local.get('settings');
  if (settings) {
    let newDataArray = convertOldStringToDataArray(settings);
    await browser.storage.local.remove('settings');
    await browser.storage.local.set({ tabsArray: newDataArray });
  }
}

export function applyUid(item) {
  // Applies a unique id to all tabs and groups in a TaboxGroupItem
  let tabs = [...item.tabs];
  let chromeGroups = [...item.chromeGroups];
  tabs.forEach((tab) => tab.uid = uid(tab));
  if (chromeGroups.length > 0) {
    chromeGroups.forEach((group) => {
      const groupUid = uid(group);
      group.uid = groupUid;
      tabs = tabs.map(t => (t.groupId === group.id ? { ...t, groupUid: groupUid } : t));
    });
  }
  return new TaboxGroupItem(item.name, tabs, chromeGroups, item.color, item.createdOn);
}

export async function getCurrentTabsAndGroups(title, onlyHighlighted = false) {
  let tabQueryProperties = { currentWindow: true };
  if (onlyHighlighted) tabQueryProperties.highlighted = true;
  let tabs = await browser.tabs.query(tabQueryProperties);
  let allChromeGroups = await browser.tabGroups.query({});
  if (allChromeGroups && allChromeGroups.length > 0) {
    const groupIds = [...new Set(tabs.filter(({ groupId }) => groupId > -1).map((t) => t.groupId))];
    allChromeGroups = allChromeGroups.filter(({ id }) => groupIds.includes(id));
  }
  const newItem = new TaboxGroupItem(title, tabs, allChromeGroups);
  return applyUid(newItem);
}