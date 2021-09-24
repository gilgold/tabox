try {
  importScripts('browser-polyfill.min.js');
  importScripts('background-utils.js');
}
catch (e) {
  console.error(e);
}

async function openTabs(collection, window = null, newWindow = null) {
    let updatedTabsWithNewId = [];
    const currentUrlsInWindow = window.tabs.map((t) => t.url);
    const {chkIgnoreDuplicates} = newWindow ?? await browser.storage.local.get('chkIgnoreDuplicates');
    collection.tabs.forEach((tabInGrp, index) => {
      if (chkIgnoreDuplicates && currentUrlsInWindow.includes(tabInGrp.url)) { return; }
      let tabInTaboxGrp = {...tabInGrp}; // create a copy since tabInGrp is immutable
      let tabProperties = {
          pinned: tabInTaboxGrp.pinned,
          active: tabInTaboxGrp.active
      };
      const updateOnlyProperties = {
          url: tabInTaboxGrp.url,
          muted: tabInTaboxGrp.muted
      }
      if (index === 0 && (window.tabs.length === 1 && (!window.tabs[0].url || window.tabs[0].url.indexOf('://newtab') > 0))){
          tabInTaboxGrp.newTabId = window.tabs[0].id;
          updatedTabsWithNewId.push(tabInTaboxGrp);
          browser.tabs.update(window.tabs[0].id,{...tabProperties, ...updateOnlyProperties});
      } else {
          tabProperties.windowId = window.id;
          browser.tabs.create(tabProperties).then((newTab) => {
            tabInTaboxGrp.newTabId = newTab.id;
            browser.tabs.update(newTab.id, updateOnlyProperties).then((t) => {
              updatedTabsWithNewId.push(tabInTaboxGrp);
              if (index === collection.tabs.length - 1) {
                  // reached the last tab to open
                  applyChromeGroupSettings(updatedTabsWithNewId, window.id, collection);
              } 
            });
          });       
      }
    });
    return true;
}

try {
  browser.runtime.onMessage.addListener(async (request) => {
    if (request.type === 'openTabs') {
      openTabs(request.collection, request.window);
      return;
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
        if (token === false) return Promise.reject('unable to get token');
        await getOrCreateSyncFile(token);
        const user = await getGoogleUser(token);
        return Promise.resolve(user);
      } catch {
        return Promise.resolve(false);
      }
    }

    if (request.type === 'updateRemote') {
      const token = await getAuthToken();
      if (token === false) return Promise.reject('unable to get token');
      await updateRemote(token);
      return Promise.resolve(true);
    }

    if (request.type === 'loadFromServer') {
      const token = await getAuthToken();
      if (token === false) return Promise.reject('unable to get token');
      const newData = await updateLocalDataFromServer(token, request.force);
      return Promise.resolve(newData);
    }

    if (request.type === 'logout') {
      const token = await getAuthToken();
      if (token === false) return;
      await removeToken(token);
      await browser.storage.local.remove(['googleUser', 'googleRefreshToken']);
      await browser.storage.sync.remove('syncFileId');
    }

    if (request.type === 'checkSyncStatus') {
      const token = await getAuthToken();
      if (token === false) return Promise.reject(false);
      await getOrCreateSyncFile(token);
      const user = await getGoogleUser(token);
      return Promise.resolve(user);
    }
  });
  chrome.commands.onCommand.addListener(async (command) => {
    const index = parseInt(command.replace('open-collection-', '')) - 1;
    const {tabsArray} = await browser.storage.local.get('tabsArray');
    if (!tabsArray || tabsArray.length === 0 || index > tabsArray.length - 1) return;
    console.log(`opening collection: '${tabsArray[index].name}'`);
    let window = await browser.windows.create({ focused: true });
    window.tabs = await browser.tabs.query({ windowId: window.id });
    await openTabs(tabsArray[index], window, true);
  });
  browser.runtime.onInstalled.addListener(async (details) => {
    const previousVersion = details.previousVersion;
    const reason = details.reason;
    if (reason === 'install') {
      const {tabsArray} = await browser.storage.local.get('tabsArray');
      if (!tabsArray) {
        await browser.storage.local.set({tabsArray: []});
      }
    }
    if (reason === "update") {
      const {tabsArray} = await browser.storage.local.get('tabsArray');
      const backupObj = {
        version: previousVersion,
        tabsArray: tabsArray
      }
      await browser.storage.local.set({backup: backupObj});
    }
 })
} catch (e) {
  console.error(e)
};