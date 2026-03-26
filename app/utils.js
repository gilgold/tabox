import TaboxCollection from './model/TaboxCollection';
import { browser } from '../static/globals';
import { generateUid } from './utils/sharedConstants';

export function downloadTextFile(text, filename, extension = 'txt') {
  // Downloads a text file
  const element = document.createElement("a");
  const file = new Blob([text], { type: 'text/plain' });
  element.href = URL.createObjectURL(file);
  const normalizedExtension = `${extension}`.replace(/^\./, '');
  element.download = `${filename}.${normalizedExtension}`;
  document.body.appendChild(element);
  element.click();
}

export function applyUid(item) {
  // Applies a unique id to all tabs and groups in a TaboxCollection
  // Using shared generateUid function for consistency
  if (!item || !('tabs' in item) || item.tabs.length === 0) return item;
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
  const newCollection = new TaboxCollection(
    item.name,
    tabs,
    chromeGroups,
    item.color,
    item.createdOn,
    item.window,
    item.lastUpdated,
    item.lastOpened
  );
  
  // Preserve the original collection UID if it exists
  if (item.uid) {
    newCollection.uid = item.uid;
  }
  
  // Preserve the parentId if it exists (for folder-collection relationships)
  // parentId can be null (root level) or a string (folder UID)
  if (item.parentId !== undefined) {
    newCollection.parentId = item.parentId;
  }
  
  // Preserve incognito metadata if it exists
  if (item.savedFromIncognito !== undefined) {
    newCollection.savedFromIncognito = item.savedFromIncognito;
  }
  if (item.incognitoTabCount !== undefined) {
    newCollection.incognitoTabCount = item.incognitoTabCount;
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
  let isFromIncognito = false;
  try {
    window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
    // Detect if this is an incognito window
    isFromIncognito = window.incognito === true;
    delete window.tabs;
  } catch (error) {
    console.error('Failed to get current window in getCurrentTabsAndGroups:', error);
    // Return a basic collection without window info
    const newItem = new TaboxCollection(title, tabs, allChromeGroups, null, null, null, null);
    return applyUid(newItem);
  }
  
  // Count incognito tabs and mark them
  const incognitoTabCount = tabs.filter(t => t.incognito === true).length;
  tabs = tabs.map(t => ({
    ...t,
    wasIncognito: t.incognito === true
  }));
  
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
  
  // Add incognito metadata
  newItem.savedFromIncognito = isFromIncognito;
  newItem.incognitoTabCount = incognitoTabCount;
  
  return applyUid(newItem);
}

/**
 * Get all windows with their tabs and groups to create a folder with collections
 * @param {string} folderName - Name for the folder
 * @param {string} folderColor - Color for the folder
 * @returns {Promise<{folder: TaboxFolder, collections: TaboxCollection[]}>} Folder and collections data
 */
export async function getAllWindowsTabsAndGroups(folderName, folderColor = '#4facfe') {
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
    const folder = new TaboxFolder(folderName, folderColor, null, null, true);
    
    // Create collections for each window
    const collections = [];
    
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      
      // Detect if this is an incognito window
      const isFromIncognito = window.incognito === true;
      
      // Get tabs for this window
      let tabQueryProperties = { windowId: window.id };
      if (chkIgnorePinned) tabQueryProperties.pinned = false;
      
      let tabs = await browser.tabs.query(tabQueryProperties);
      
      // Skip windows with no tabs (shouldn't happen but be safe)
      if (!tabs || tabs.length === 0) continue;
      
      // Count incognito tabs and mark them
      const incognitoTabCount = tabs.filter(t => t.incognito === true).length;
      tabs = tabs.map(t => ({
        ...t,
        wasIncognito: t.incognito === true
      }));
      
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
      
      // Create collection name based on window (include incognito indicator in name)
      let collectionName = windows.length === 1 
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
      
      // Add incognito metadata
      collection.savedFromIncognito = isFromIncognito;
      collection.incognitoTabCount = incognitoTabCount;
      
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
export { tabGroupColorChart as tabGrooupColorChart, getColorCode } from './utils/colorUtils';

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
