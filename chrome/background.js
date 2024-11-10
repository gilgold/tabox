/* eslint-disable no-undef */
try {
  importScripts('browser-polyfill.min.js');
  importScripts('background-utils.js');
}
catch (e) {
  console.error(e);
}
let updateInProgress = false;

const AUTO_BACKUP_ALARM = 'auto-backup-alarm';

async function setInitialOptions() {
  const {
    tabsArray,
    chkOpenNewWindow,
    collectionsToTrack,
    localTimestamp,
    chkEnableTabDiscard,
    currentSortValue,
  } = await browser.storage.local.get([
    'tabsArray',
    'chkOpenNewWindow',
    'collectionsToTrack',
    'localTimestamp',
    'chkEnableTabDiscard',
    'currentSortValue',
  ]);
  if (tabsArray === undefined || tabsArray == {}) {
    await browser.storage.local.set({ tabsArray: [] });
  }
  if (localTimestamp === undefined || localTimestamp == {}) {
    await browser.storage.local.set({ localTimestamp: 0 });
  }
  if (collectionsToTrack === undefined || collectionsToTrack == {}) {
    await browser.storage.local.set({ collectionsToTrack: [] });
  }
  if (chkOpenNewWindow === undefined || chkOpenNewWindow == {}) {
    await browser.storage.local.set({ chkOpenNewWindow: true });
  }
  if (chkEnableTabDiscard === undefined || chkEnableTabDiscard == {}) {
    await browser.storage.local.set({ chkEnableTabDiscard: true });
  }
  if (currentSortValue === undefined || currentSortValue == {}) {
    await browser.storage.local.set({ currentSortValue: 'DATE' });
  }
}

async function handleBadge() {
  const { chkShowBadge } = await browser.storage.local.get('chkShowBadge');
  if (!chkShowBadge) {
    browser.action.setBadgeText({ text: '' });
    return;
  }
  const tabCount = (await browser.tabs.query({ windowId: browser.windows.WINDOW_ID_CURRENT })).length;
  let badgeColor;
  if (tabCount <= 20) badgeColor = '#07A361';
  if (tabCount > 20 && tabCount <= 50) badgeColor = '#DF9402';
  if (tabCount > 50) badgeColor = '#DB392F';
  browser.action.setBadgeBackgroundColor({ color: badgeColor });
  browser.action.setBadgeText({ text: tabCount.toString() });
}

async function handleAutoUpdate(windowId, timeDelay = 1, rebuildContextMenus = false) {
  const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
  if (!chkEnableAutoUpdate) { return; }
  const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
  if (!collectionsToTrack || collectionsToTrack.length === 0) return;
  const tracked = collectionsToTrack.find(c => c.windowId === windowId);
  if (!tracked) { return; }
  try {
    await browser.windows.get(windowId);
  } catch (e) {
    return;
  }
  const { tabsArray } = await browser.storage.local.get('tabsArray');
  let newTabsArray = [...tabsArray];
  const index = newTabsArray.findIndex(c => c.uid === tracked.collectionUid);
  if (index === -1) { return; }
  const newCollection = await updateCollection(newTabsArray[index], windowId);
  newTabsArray[index] = newCollection;
  await browser.storage.local.set({ tabsArray: newTabsArray });
  if (updateInProgress) { return; }
  updateInProgress = true;
  if (rebuildContextMenus && JSON.stringify(tabsArray[index].chromeGroups) !== JSON.stringify(newCollection.chromeGroups)) await handleContextMenuCreation();
  setTimeout(async () => {
    await handleRemoteUpdate(windowId);
    updateInProgress = false;
  }, timeDelay);
}

async function handleRemoteUpdate() {
  const { googleUser } = await browser.storage.local.get('googleUser');
  if (!googleUser) { return; }
  const token = await getAuthToken();
  if (token === false) return false;
  await updateRemote(token);
  return true;
}

async function addCollectionToTrack(collectionUid, windowId) {
  setTimeout(async () => {
    let { collectionsToTrack } = (await browser.storage.local.get('collectionsToTrack')) || [];
    const index = collectionsToTrack.findIndex(c => c.collectionUid === collectionUid);
    if (index !== undefined && index > -1) {
      collectionsToTrack[index].windowId = windowId;
    } else {
      collectionsToTrack.push({
        collectionUid: collectionUid,
        windowId: windowId
      });
    }
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }, 300);
}

function shouldDiscardTab(tab) {
  const conditions = [
    tab.url.indexOf('://newtab') < 0,
    tab.url.indexOf('chrome://') < 0,
    tab.url.indexOf('chrome-extension://') < 0,
    tab.url.indexOf('chrome-devtools://') < 0,
    !tab.pinned,
    !tab.active,
  ];
  return conditions.every(c => c === true);
}

const isNewWindow = window => window?.tabs?.length === 1 && (!window?.tabs[0].url || window?.tabs[0].url.indexOf('://newtab') > 0);

async function openTabs(collection, window, newWindow = null) {
  const currentUrlsInWindow = window.tabs ? window.tabs.map((t) => t.url) : [];
  const { chkIgnoreDuplicates } = newWindow ?? await browser.storage.local.get('chkIgnoreDuplicates');
  const { chkEnableTabDiscard } = await browser.storage.local.get('chkEnableTabDiscard');
  collection.tabs.forEach(async (tabInGrp, index, arr) => {
    if (chkIgnoreDuplicates && currentUrlsInWindow.includes(tabInGrp.url)) { return; }
    let isFile = tabInGrp.url.startsWith('file:///');
    let tabProperties = {
      pinned: tabInGrp.pinned,
      active: tabInGrp.active,
      url: (chkEnableTabDiscard && shouldDiscardTab(tabInGrp) && !isFile) ? browser.runtime.getURL(`deferedLoading.html?url=${tabInGrp.url}&favicon=${tabInGrp?.favIconUrl || ''}`) : tabInGrp.url,
    };
    const updateOnlyProperties = {
      muted: tabInGrp.muted,
    }
    let tab;
    if (index === 0 && isNewWindow(window)) {
      tab = await browser.tabs.update(window.tabs[0].id, { ...tabProperties, ...updateOnlyProperties });
    } else {
      tabProperties.windowId = window.id;
      tab = await browser.tabs.create(tabProperties);
      await browser.tabs.update(tab.id, updateOnlyProperties);
    }
    arr[index].newTabId = tab.id;
    if (index === arr.length - 1) {
      applyChromeGroupSettings(window.id, collection);
      addCollectionToTrack(collection.uid, window.id);
    }
  });
  return true;
}

try {
  browser.runtime.onMessage.addListener(async (request) => {
    if (request.type === 'checkSyncStatus') {
      const { googleUser } = await browser.storage.local.get('googleUser');
      if (!googleUser) return Promise.resolve(false);
      const token = await getAuthToken();
      if (token === false) return Promise.resolve(false);
      const syncFileSuccess = await getOrCreateSyncFile(token);
      if (syncFileSuccess === false) return Promise.resolve(false);
      const user = await getGoogleUser(token);
      return Promise.resolve(user);
    }
    if (request.type === 'login') {
      try {
        const redirectUrl = await browser.identity.launchWebAuthFlow({
          'url': createAuthEndpoint(),
          'interactive': true
        });
        const url = new URL(redirectUrl);
        const urlParams = url.searchParams;
        const params = Object.fromEntries(urlParams.entries());
        const token = await getTokens(params.code);
        if (token === false) return Promise.resolve(false);
        await getOrCreateSyncFile(token);
        const user = await getGoogleUser(token);
        await syncData(token);
        return Promise.resolve(user);
      } catch {
        return Promise.resolve(false);
      }
    }
    if (request.type === 'openTabs') {
      await openTabs(request.collection, request.window);
      return Promise.resolve(true);
    }

    if (request.type === 'updateBadge') {
      await handleBadge();
      return Promise.resolve(true);
    }

    if (request.type === 'updateRemote') {
      const res = await handleRemoteUpdate();
      return Promise.resolve(res);
    }

    if (request.type === 'loadFromServer') {
      const token = await getAuthToken();
      if (token === false) return Promise.resolve(false);
      const newData = await updateLocalDataFromServer(token, request.force);
      if (newData === false) await updateRemote(token);
      return Promise.resolve(newData);
    }

    if (request.type === 'logout') {
      const token = await getAuthToken();
      if (token === false) return Promise.resolve(true);
      await browser.storage.local.remove('googleUser');
      await browser.storage.sync.remove('syncFileId');
      return Promise.resolve(true);
    }

    if (request.type === 'focusWindow') {
      await browser.windows.update(request.windowId, { focused: true });
      return Promise.resolve(true);
    }

    if (request.type === 'addCollection') {
      await handleContextMenuCreation();
      return Promise.resolve(true);
    }
  });
  browser.commands.onCommand.addListener(async (command) => {
    const index = parseInt(command.replace('open-collection-', '')) - 1;
    const { tabsArray } = await browser.storage.local.get('tabsArray');
    if (!tabsArray || tabsArray.length === 0 || index > tabsArray.length - 1) return;
    console.log(`opening collection with keyboard shortcut: '${tabsArray[index].name}'`);
    let window;
    const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
    if (chkOpenNewWindow) {
      window = await browser.windows.create({ focused: true });
    } else {
      window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
    }
    window.tabs = await browser.tabs.query({ windowId: window.id });
    await openTabs(tabsArray[index], window, true);
  });

  const handleMenuClick = async (info, tab) => {
    if (info.menuItemId === 'tabox-super') return;
    let { tabsArray } = await browser.storage.local.get('tabsArray');
    let tabToAdd = { ...tab };
    const isClickOnTabGroup = info?.menuItemId?.includes('-main');
    const collectionUid = isClickOnTabGroup ? info?.parentMenuItemId?.replace('-main', '') : info.menuItemId;
    const collectionIndex = tabsArray.findIndex(c => c.uid === collectionUid);
    if (isClickOnTabGroup) {
      // add to inside a chrome group
      const groupUid = info.menuItemId.split('|')[1];
      const group = tabsArray[collectionIndex].chromeGroups?.find(cg => cg.uid === groupUid);
      const indexInTabs = tabsArray[collectionIndex].tabs.findIndex(t => t.groupUid === group.uid);
      tabToAdd.groupId = group.id;
      tabToAdd.groupUid = group.uid;
      tabsArray[collectionIndex]?.tabs?.splice(indexInTabs, 0, tabToAdd);
    } else {
      tabsArray[collectionIndex]?.tabs?.push(tabToAdd);
    }

    await browser.storage.local.set({ tabsArray });
    await handleRemoteUpdate();
  }

  browser.contextMenus.onClicked.addListener(handleMenuClick);

  const handleAutoBackupAlarm = async () => {
    const alarms = await browser.alarms.getAll();
    const hasAlarm = alarms.some(a => a.name === AUTO_BACKUP_ALARM);
    if (hasAlarm) {
      await browser.alarms.clear(AUTO_BACKUP_ALARM);
    }
    browser.alarms.create(AUTO_BACKUP_ALARM, {
      delayInMinutes: 0.1,
      periodInMinutes: 0.1
    })
  }

  browser.runtime.onInstalled.addListener(async (details) => {
    const previousVersion = details.previousVersion;
    const reason = details.reason;
    await setInitialOptions();
    await handleContextMenuCreation();
    await handleBadge();
    await handleAutoBackupAlarm();
    if (reason === "update") {
      let { tabsArray } = await browser.storage.local.get('tabsArray');
      if (!tabsArray || tabsArray.length === 0) return;
      tabsArray = updateCollectionsUids(tabsArray);
      const backupObj = {
        version: previousVersion,
        tabsArray: tabsArray
      }
      await browser.storage.local.set({ backup: backupObj });
    }
  })

  const handleAutoBackup = async () => {
    let { autoBackups } = await browser.storage.local.get('autoBackups');
    const { tabsArray } = await browser.storage.local.get('tabsArray');
    const { localTimestamp } = await browser.storage.local.get('localTimestamp');
    if (autoBackups === undefined) {
      autoBackups = [];
    }
    if ((tabsArray && tabsArray.length === 0) || (autoBackups.length > 0 && autoBackups[0].timestamp === localTimestamp)) {
      return;
    }
    const backupObj = {
      timestamp: localTimestamp || Date.now(),
      tabsArray
    }
    autoBackups.unshift(backupObj);
    if (autoBackups.length > 5) {
      autoBackups.pop();
    }
    await browser.storage.local.set({ autoBackups });
  }

  const handleSaveSession = async (updateCurrent = false) => {
    const windows = await browser.windows.getAll();
    let { sessions } = await browser.storage.local.get('sessions');
    if (sessions === undefined) {
      sessions = [];
    }
    let sessionCollections = [];
    for (const window of windows) {
      const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const collection = await updateCollection({
        uid: uid,
        name: `Session, ${new Date().toLocaleString()}`,
      }, window.id);
      sessionCollections.push(collection);
    }

    if (updateCurrent && sessions.length > 0) {
      sessions.shift();
    }

    const sessionObj = {
      timestamp: Date.now(),
      collections: sessionCollections
    }
    
    sessions.unshift(sessionObj);
    if (sessions.length > 5) {
      sessions.pop();
    }
    await browser.storage.local.set({ sessions });
  }

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_BACKUP_ALARM) {
      await handleAutoBackup();
    }
  });

  // window events
  browser.windows.onRemoved.addListener(async windowId => {
    await handleSaveSession();
    let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    if (!collectionsToTrack || collectionsToTrack.length === 0) { return; }
    collectionsToTrack = collectionsToTrack.filter(c => c.windowId !== windowId);
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }, { windowTypes: ['normal'] });

  browser.windows.onCreated.addListener(async () => {
    await handleBadge();
    await handleSaveSession();
  });

  browser.windows.onFocusChanged.addListener(async () => {
    await handleBadge();
  });

  browser.windows.onBoundsChanged.addListener(async window => {
    await handleAutoUpdate(window.id, 5000);
  });

  // tab events
  browser.tabs.onCreated.addListener(async tab => {
    await handleBadge();
    await handleAutoUpdate(tab.windowId, 1);
    await handleSaveSession(true);
  });
  browser.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    await handleSaveSession(true);
    const allowedChanges = ['mutedInfo', 'pinned', 'groupId'];
    const allowUpdate = Object.keys(changeInfo).some(key => allowedChanges.includes(key));
    if (('status' in changeInfo && changeInfo.status === 'complete') || allowUpdate) {
      await handleAutoUpdate(tab.windowId);
    }
  });
  browser.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
    await handleSaveSession(true);
    await handleAutoUpdate(detachInfo.oldWindowId);
    await handleBadge();
  });
  browser.tabs.onAttached.addListener(async (_tabId, attachInfo) => {
    await handleSaveSession(true);
    await handleAutoUpdate(attachInfo.newWindowId);
    await handleBadge();
  });
  browser.tabs.onMoved.addListener(async (_tabId, moveInfo) => {
    await handleSaveSession(true);
    await handleAutoUpdate(moveInfo.windowId, 1);
  });
  browser.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
    await handleSaveSession(true);
    if (removeInfo.isWindowClosing) return;
    await handleBadge();
    await handleAutoUpdate(removeInfo.windowId);
  });

  // tabGroup events
  browser.tabGroups.onCreated.addListener(async (tabGroup) => {
    await handleSaveSession(true);
    await handleAutoUpdate(tabGroup.windowId, 0, true);
  });
  browser.tabGroups.onRemoved.addListener(async (tabGroup) => {
    await handleSaveSession(true);
    await handleAutoUpdate(tabGroup.windowId, 0, true);
  });
  browser.tabGroups.onUpdated.addListener(async (tabGroup) => {
    await handleSaveSession(true);
    await handleAutoUpdate(tabGroup.windowId, 0, true);
  });
} catch (e) {
  console.error(e)
}