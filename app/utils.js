import TaboxCollection from './model/TaboxCollection';
import { browser } from '../static/globals';
import { generateUid } from './utils/sharedConstants';

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
  // Using shared generateUid function for consistency
  if (!item || !('tabs' in item) || item.tabs.length === 0) return item;
  console.log('applying uid to collection', item.name);
  let tabs = [...item.tabs];
  let chromeGroups = item.chromeGroups ? [...item.chromeGroups] : [];
  tabs.forEach((tab) => {
    tab.uid = generateUid();
  });
  if (chromeGroups.length > 0) {
    chromeGroups.forEach((group) => {
      const groupUid = generateUid();
      group.uid = groupUid;
      tabs = tabs.map(t => (t.groupId === group.id ? { ...t, groupUid: groupUid } : t));
    });
  }
  
  // Create new collection but preserve existing UID and timestamps
  const newCollection = new TaboxCollection(item.name, tabs, chromeGroups, item.color, item.createdOn, item.window, item.lastUpdated, item.lastOpened);
  
  // Preserve the original collection UID if it exists
  if (item.uid) {
    newCollection.uid = item.uid;
  }
  
  return newCollection;
}

export async function getCurrentTabsAndGroups(title, forceOnlyHighlighted = false) {
  let tabQueryProperties = { currentWindow: true };
  const totalHighlighted = await browser.tabs.query({ highlighted: true, windowId: browser.windows.WINDOW_ID_CURRENT });
  const onlyHighlighted = forceOnlyHighlighted || totalHighlighted.length > 1;
  const { chkIgnorePinned } = await browser.storage.local.get('chkIgnorePinned');
  if (onlyHighlighted) tabQueryProperties.highlighted = true;
  if (chkIgnorePinned) tabQueryProperties.pinned = false;
  let tabs = await browser.tabs.query(tabQueryProperties);
  let window;
  try {
    window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
    delete window.tabs;
  } catch (error) {
    console.error('Failed to get current window in getCurrentTabsAndGroups:', error);
    // Return a basic collection without window info
    const newItem = new TaboxCollection(title, tabs, allChromeGroups, null, null, null, null);
    return applyUid(newItem);
  }
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
  const newItem = new TaboxCollection(title, tabs, allChromeGroups, null, null, window, null);
  return applyUid(newItem);
}

/**
 * Get all windows with their tabs and groups to create a folder with collections
 * @param {string} folderName - Name for the folder
 * @returns {Promise<{folder: TaboxFolder, collections: TaboxCollection[]}>} Folder and collections data
 */
export async function getAllWindowsTabsAndGroups(folderName) {
  try {
    const { chkIgnorePinned } = await browser.storage.local.get('chkIgnorePinned');
    const TaboxFolder = (await import('./model/TaboxFolder')).default;
    
    // Get all normal browser windows
    const windows = await browser.windows.getAll({ 
      populate: true, 
      windowTypes: ['normal'] 
    });
    
    if (windows.length === 0) {
      throw new Error('No windows found');
    }
    
    // Create folder with default blue color and collapsed state
    const folder = new TaboxFolder(folderName, '#4facfe', null, null, true);
    
    // Create collections for each window
    const collections = [];
    
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      
      // Get tabs for this window
      let tabQueryProperties = { windowId: window.id };
      if (chkIgnorePinned) tabQueryProperties.pinned = false;
      
      let tabs = await browser.tabs.query(tabQueryProperties);
      
      // Skip windows with no tabs (shouldn't happen but be safe)
      if (!tabs || tabs.length === 0) continue;
      
      // Get tab groups for this window
      let allChromeGroups = [];
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
      }
      
      // Create collection name based on window
      const collectionName = windows.length === 1 
        ? folderName 
        : `${folderName} - Window ${i + 1}`;
      
      // Create collection for this window
      const windowForCollection = { ...window };
      delete windowForCollection.tabs; // Remove tabs to avoid duplication
      
      const collection = new TaboxCollection(
        collectionName, 
        tabs, 
        allChromeGroups, 
        null, 
        null, 
        windowForCollection, 
        null
      );
      
      // Set the collection's parent to the folder
      collection.parentId = folder.uid;
      
      const collectionWithUid = applyUid(collection);
      collections.push(collectionWithUid);
    }
    
    // Update folder collection count
    folder.collectionCount = collections.length;
    
    return {
      folder: folder,
      collections: collections
    };
    
  } catch (error) {
    console.error('Failed to get all windows tabs and groups:', error);
    throw error;
  }
}

// Color utilities moved to app/utils/colorUtils.js for consolidation
export { tabGroupColorChart as tabGrooupColorChart, getColorCode, getColorName } from './utils/colorUtils';

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

/**
 * Generate a unique copy name for a collection
 * @param {string} originalName - Original collection name
 * @param {Array} existingCollections - Array of existing collections
 * @returns {string} Unique copy name with (copy) or (copy N) suffix
 */
export const generateCopyName = (originalName, existingCollections) => {
  const existingNames = existingCollections.map(c => c.name);
  
  // Check if the name already ends with " (copy)" or " (copy N)"
  let baseName = originalName;
  const copyPattern = /^(.*?)\s*\(copy(?:\s+(\d+))?\)$/;
  const match = originalName.match(copyPattern);
  
  if (match) {
    // Name already has (copy) or (copy N) suffix - use the base name
    baseName = match[1];
  }
  
  // Try with " (copy)" first
  const copyName = `${baseName} (copy)`;
  if (!existingNames.includes(copyName)) {
    return copyName;
  }
  
  // If " (copy)" exists, start numbering from 2
  let counter = 2;
  let newName = `${baseName} (copy ${counter})`;
  
  while (existingNames.includes(newName)) {
    counter++;
    newName = `${baseName} (copy ${counter})`;
  }
  
  return newName;
}
