/* eslint-disable no-undef */
try {
  importScripts('browser-polyfill.min.js');
  importScripts('background-utils.js');
}
catch (e) {
  console.error(e);
}
let updateInProgress = false;

async function setInitialOptions() {
  const { 
    tabsArray, 
    chkOpenNewWindow,
    collectionsToTrack,
    localTimestamp,
    chkEnableTabDiscard,
  } = await browser.storage.local.get([
    'tabsArray', 
    'chkOpenNewWindow', 
    'collectionsToTrack',
    'localTimestamp',
    'chkEnableTabDiscard',
  ]);
  if (tabsArray === undefined || tabsArray === {}) {
    await browser.storage.local.set({ tabsArray: [] });
  }
  if (localTimestamp === undefined || localTimestamp === {}) {
    await browser.storage.local.set({ localTimestamp: 0 });
  }
  if (collectionsToTrack === undefined || collectionsToTrack === {}) {
    await browser.storage.local.set({ collectionsToTrack: [] });
  }
  if (chkOpenNewWindow === undefined || chkOpenNewWindow === {}) {
    await browser.storage.local.set({ chkOpenNewWindow: true });
  }
  if (chkEnableTabDiscard === undefined || chkEnableTabDiscard === {}) {
    await browser.storage.local.set({ chkEnableTabDiscard: true });
  }
}

async function handlleAutoUpdate(windowId, timeDelay = 1) {
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

const dummyCatchHandler = () => {};

async function openTabs(collection, window, newWindow = null) {
    const currentUrlsInWindow = window.tabs ? window.tabs.map((t) => t.url) : [];
    const { chkIgnoreDuplicates } = newWindow ?? await browser.storage.local.get('chkIgnoreDuplicates');
    const { chkEnableTabDiscard } = await browser.storage.local.get('chkEnableTabDiscard');
    collection.tabs.forEach((tabInGrp, index, arr) => {
      if (chkIgnoreDuplicates && currentUrlsInWindow.includes(tabInGrp.url)) { return; }
      let tabProperties = {
          pinned: tabInGrp.pinned,
          active: tabInGrp.active,
          url: tabInGrp.url,
      };
      const updateOnlyProperties = {
          muted: tabInGrp.muted,
      }

      if (index === 0 && (window.tabs.length === 1 && (!window.tabs[0].url || window.tabs[0].url.indexOf('://newtab') > 0))){
        browser.tabs.update(window.tabs[0].id,{ ...tabProperties, ...updateOnlyProperties }).then(tab => {
          arr[index].newTabId = tab.id;
          if (index === arr.length - 1) {
            applyChromeGroupSettings(window.id, collection);
            addCollectionToTrack(collection.uid, window.id);
          }
        });
      } else {
        tabProperties.windowId = window.id;
        browser.tabs.create(tabProperties).then((newTab) => {
          arr[index].newTabId = newTab.id;
          let discardedTabs = [];
          browser.tabs.update(newTab.id, updateOnlyProperties).then(updatedTab => {
            if (chkEnableTabDiscard) {
              chrome.tabs.onUpdated.addListener(function listener (tabId, info) {
                if (tabId === updatedTab.id) {
                    if (info.favIconUrl !== undefined || info.status === 'complete') {
                      if(shouldDiscardTab(updatedTab)) {
                        browser.tabs.discard(updatedTab.id).then().catch(dummyCatchHandler);
                        discardedTabs.push(tabId);
                        chrome.tabs.onUpdated.removeListener(listener);
                      }
                    } else {
                      setTimeout(() => {
                        if (!discardedTabs.includes(tabId)) {
                          browser.tabs.get(tabId).then(t => {
                            if(shouldDiscardTab(t)) {
                              browser.tabs.discard(t.id).then().catch(dummyCatchHandler);
                              discardedTabs.push(t.id);
                            }
                            }).catch(dummyCatchHandler);
                            chrome.tabs.onUpdated.removeListener(listener);
                        }
                      }, 5000)
                    }
                  } 
              });
            }
            if (index === arr.length - 1) {
              applyChromeGroupSettings(window.id, collection);
              addCollectionToTrack(collection.uid, window.id);
            }
          });
        });       
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
  });
  browser.commands.onCommand.addListener(async (command) => {
    const index = parseInt(command.replace('open-collection-', '')) - 1;
    const { tabsArray } = await browser.storage.local.get('tabsArray');
    if (!tabsArray || tabsArray.length === 0 || index > tabsArray.length - 1) return;
    console.log(`opening collection with keyboard shortcut: '${tabsArray[index].name}'`);
    let window = await browser.windows.create({ focused: true });
    window.tabs = await browser.tabs.query({ windowId: window.id });
    await openTabs(tabsArray[index], window, true);
  });
  browser.runtime.onInstalled.addListener(async (details) => {
    const previousVersion = details.previousVersion;
    const reason = details.reason;
    await setInitialOptions();
    if (reason === "update") {
      let { tabsArray } = await browser.storage.local.get('tabsArray');
      tabsArray = updateCollectionsUids(tabsArray);
      const backupObj = {
        version: previousVersion,
        tabsArray: tabsArray
      }
      await browser.storage.local.set({ backup: backupObj });
    }
 })
 // window events
 browser.windows.onRemoved.addListener(async windowId => {
  let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
  if (!collectionsToTrack || collectionsToTrack.length === 0) { return; }
  const index = collectionsToTrack.findIndex(c => c.windowId === windowId);
  if (index === -1) { return; }
  collectionsToTrack.splice(index, 1);
  await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
 }, { windowTypes: ['normal'] });

 browser.windows.onBoundsChanged.addListener(async window => {
  await handlleAutoUpdate(window.id, 5000);
 });

 // tab events
 browser.tabs.onCreated.addListener(async tab => {
  await handlleAutoUpdate(tab.windowId, 1000);
 });
 browser.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  const allowedChanges = ['mutedInfo', 'pinned', 'groupId'];
  const allowUpdate = Object.keys(changeInfo).some(key => allowedChanges.includes(key));
  if (('status' in changeInfo && changeInfo.status === 'complete') || allowUpdate) {
    await handlleAutoUpdate(tab.windowId);
  }
 });
 browser.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
  await handlleAutoUpdate(detachInfo.oldWindowId);
 });
 browser.tabs.onAttached.addListener(async (_tabId, attachInfo) => {
  await handlleAutoUpdate(attachInfo.newWindowId);
 });
 browser.tabs.onMoved.addListener(async (_tabId, moveInfo) => {
  await handlleAutoUpdate(moveInfo.windowId, 1000);
 });
 browser.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
   if (removeInfo.isWindowClosing) return;
   await handlleAutoUpdate(removeInfo.windowId);
 });

 // tabGroup events
 browser.tabGroups.onCreated.addListener(async (tabGroup) => {
  await handlleAutoUpdate(tabGroup.windowId);
 });
 browser.tabGroups.onRemoved.addListener(async (tabGroup) => {
  await handlleAutoUpdate(tabGroup.windowId);
 });
 browser.tabGroups.onUpdated.addListener(async (tabGroup) => {
  await handlleAutoUpdate(tabGroup.windowId, 5000);
 });
} catch (e) {
  console.error(e)
}