/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

let lastValidated = 0;

async function handleRequest(url, options = null) {
    try {
        const response = await fetch(url, options);
        if (response.ok) return (await response.json());
    } catch {
        return false;
    }
    return false;
}

function updateCollectionsUids(collections) {
    console.log('checking collections UIDs');
    if (!collections) { return; }
    let tabsArray = collections;
    tabsArray.forEach((collection, index) => {
      if (collection.uid.includes('uid')) {
        const newUid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        tabsArray[index].uid = newUid;
      }
    });
    return tabsArray;
  }

function applyChromeGroupSettings(windowId, collection) {
    if (!collection.chromeGroups || !browser.tabs.group || !browser.tabGroups) {
      return;
    }
    collection.chromeGroups.forEach((chromeGroup) => {
      const tabsToGroup = collection.tabs.filter(({ groupId }) => chromeGroup.id === groupId).map((t) => t.newTabId);
      const groupProperties = {
        createProperties: {
          windowId: windowId
        }, 
        tabIds: tabsToGroup
      }
      const updateProperties = {
        collapsed: chromeGroup.collapsed,
        color: chromeGroup.color,
        title: chromeGroup.title
      };
      if (tabsToGroup && tabsToGroup.length > 0){
        browser.tabs.group(groupProperties).then((groupId) => {
          browser.tabGroups.update(groupId, updateProperties)
        });
      }
    });
  }

async function getNewAccessToken() {
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    const keysUrl = browser.runtime.getURL('api-keys.json');
    const response = await fetch(keysUrl);
    const { clientSecret } = await response.json();
    const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
    const requestBody = {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: googleRefreshToken,
        grant_type: 'refresh_token',
    }
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    }
    console.log('getting new token using refresh token');
    const tokenResponse = await handleRequest('https://oauth2.googleapis.com/token', options);
    if (tokenResponse !== false) {
        await browser.storage.local.set({ googleToken: tokenResponse.access_token });
        return tokenResponse.access_token;
    }
    return false;
}

async function getAuthToken() {
    const { googleToken } = await browser.storage.local.get('googleToken');
    if (googleToken) {
        if (Date.now() - lastValidated < 60000) return googleToken;
        console.log('validating existing token')
        const response = await handleRequest(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${googleToken}`);
        lastValidated = Date.now();
        if (response) return googleToken;
    }
    const newToken = await getNewAccessToken();
    return newToken;
}

async function getGoogleUser(token) {
    const { googleUser } = await browser.storage.local.get('googleUser');
    if (googleUser) return googleUser;
    const url = browser.runtime.getURL('api-keys.json');
    const fileResponse = await fetch(url);
    const { googleDrive: googleApiKey } = await fileResponse.json();
    const init = {
        method: 'GET',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
        'contentType': 'json'
    };
    console.log('getting google user info from server')
    const response = await handleRequest(
        `https://www.googleapis.com/drive/v3/about?alt=json&fields=user&prettyPrint=false&key=${googleApiKey}`,
        init)
    if (response) {
        await browser.storage.local.set({ googleUser: response.user });
        return response.user;
    }
    return false;
}

async function removeToken(token) {
    const _token = token === -1 ? (await browser.storage.local.get('googleToken')).googleToken : token;
    const url = 'https://accounts.google.com/o/oauth2/revoke?token=' + _token;
    await browser.storage.local.remove('googleToken');
    if (_token) await handleRequest(url);
}

async function getOrCreateSyncFile(token) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    if (syncFileId) return;
    console.log('searching for sync file on server')
    const url = "https://www.googleapis.com/drive/v3/files/?corpora=user&spaces=appDataFolder&fields=files(id)&q=name='appSettings.json'&pageSize=1&orderBy=modifiedByMeTime desc";
    const response = await handleRequest(url, {
        mode: 'cors',
        withCredentials: true,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    if (response) {
        if (response.files.length === 0) {
            console.log('no sync file found, creating new one')
            await _createNewSyncFile(token);
        } else {
            console.log('Found sync file in Google Drive')
            await browser.storage.sync.set({ syncFileId: response.files[0].id });
        }
        return true;
    }
    return false;
}

async function _createNewSyncFile(token) {
    const { tabsArray } = await browser.storage.local.get('tabsArray');
    const metadata = {
        name: 'appSettings.json',
        mimeType: 'application/json',
        parents: ['appDataFolder'],
    };
    let fileContent = {
        tabsArray: tabsArray
    };
    let file = new Blob([JSON.stringify(fileContent)], { type: 'application/json' });
    let form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);
    const init = {
        method: 'POST',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token
        },
        body: form
    };
    console.log('creating new sync file with data from storage')
    const response = await handleRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', init);
    if (response) {
        await browser.storage.sync.set({ syncFileId: response.id });
        return response.id;
    }
    return false;
}

async function _getServerFileTimestamp(token, fileId) {
    const init = {
        method: 'GET',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        'contentType': 'json'
    };
    console.log('getting sync file timestamp from server')
    const response = await handleRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=json&fields=modifiedByMeTime`, init)
    return response ? Date.parse(response.modifiedByMeTime) : response;
}

async function updateRemote(token, collections = null) {
    let { tabsArray } = await browser.storage.local.get('tabsArray');
    if (collections) tabsArray = collections;
    await getOrCreateSyncFile(token);
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    const init = {
        method: 'PATCH',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        'contentType': 'json',
        body: JSON.stringify({ tabsArray: tabsArray })
    };
    console.log('updating remote sync file with new data')
    const url = `https://www.googleapis.com/upload/drive/v3/files/${syncFileId}?uploadType=media&access_token=${token}`;
    await browser.storage.local.set({ localTimestamp: Date.now() + 200 });
    const response = await handleRequest(url, init);
    return response;
}

async function _loadSettingsFile(token, fileId) {
    const init = {
        method: 'GET',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        'contentType': 'json'
    };
    console.log('loading sync file from server')
    const data = await handleRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, init);
    await browser.storage.local.set({ localTimestamp: Date.now() });
    return updateCollectionsUids(data.tabsArray);
}

async function createNewSyncFileAndBackup(token) {
    await browser.storage.sync.remove('syncFileId');
    await getOrCreateSyncFile(token);
}

async function updateLocalDataFromServer(token, force = false) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    const serverTimestamp = await _getServerFileTimestamp(token, syncFileId);
    if (serverTimestamp === undefined || serverTimestamp === false) {
        await createNewSyncFileAndBackup(token);
        return false;
    }
    const { localTimestamp } = (await browser.storage.local.get('localTimestamp')) || 0;
    if (Math.abs(serverTimestamp - localTimestamp) < 1000 && !force) {
        console.log('data is in sync, no need to update');
        const { tabsArray } = await browser.storage.local.get('tabsArray');
        return tabsArray;
    }
    console.log(`Comparing timestamps, remote is: ${(serverTimestamp > localTimestamp) ? 'newer' : 'older'}`)
    if (serverTimestamp > localTimestamp || force) return await _loadSettingsFile(token, syncFileId);
    return false;
}

async function getTokens(code) {
    const redirectURL = browser.identity.getRedirectURL();
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    const keysUrl = browser.runtime.getURL('api-keys.json');
    const response = await fetch(keysUrl);
    const { clientSecret } = await response.json();
    const requestBody = {
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectURL,
    }
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    }
    const data = await handleRequest('https://oauth2.googleapis.com/token', options);
    await browser.storage.local.set({ googleToken: data.access_token, googleRefreshToken: data.refresh_token });
    return data ? data.access_token : false;
}

function createAuthEndpoint() {
    const redirectURL = browser.identity.getRedirectURL();
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    const authParams = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        access_type: 'offline',
        redirect_uri: redirectURL,
        prompt: 'consent',
        scope: 'openid ' + oauth2.scopes.join(' '),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;
}

function applyUid(item) {
    // Applies a unique id to all tabs and groups in a TaboxGroupItem
    if (!item || !('tabs' in item) || item.tabs.length === 0) return item;
    let tabs = [...item.tabs];
    let chromeGroups = item.chromeGroups ? [...item.chromeGroups] : [];
    let tabUidCount = 0;
    tabs.forEach((tab) => {
        tab.uid = `uid${tabUidCount}`
        tabUidCount++;
    });
    let groupUidCount = 0;
    if (chromeGroups.length > 0) {
      chromeGroups.forEach((group) => {
        const groupUid = `uid${groupUidCount}`;
        group.uid = groupUid;
        tabs = tabs.map(t => (t.groupId === group.id ? { ...t, groupUid: groupUid } : t));
        groupUidCount++;
      });
    }
    const newCollection = { ...item };
    newCollection.tabs = tabs;
    newCollection.chromeGroups = chromeGroups;
    return newCollection;
  }
  
  async function updateCollection(collection, windowId) {
    let tabQueryProperties = {
        windowId: windowId,
    };
    const { chkIgnorePinned } = await browser.storage.local.get('chkIgnorePinned');
    if (chkIgnorePinned) tabQueryProperties.pinned = false;
    let tabs = await browser.tabs.query(tabQueryProperties);
    const window = await browser.windows.get(windowId, { populate: true, windowTypes: ['normal'] });
    delete window.tabs;
    let allChromeGroups;
    if (browser.tabGroups) {
        allChromeGroups = await browser.tabGroups.query({ windowId: windowId });
        if (allChromeGroups && allChromeGroups.length > 0) {
        const groupIds = [...new Set(tabs.filter(({ groupId }) => groupId > -1).map((t) => t.groupId))];
        allChromeGroups = allChromeGroups.filter(({ id }) => groupIds.includes(id));
        }
    } else {
        allChromeGroups = [];
    }
    const newItem = {
        uid: collection.uid,
        name: collection.name,
        tabs: tabs,
        chromeGroups: allChromeGroups,
        color: collection.color,
        createdOn: Date.now(),
        window: window
    };
    return applyUid(newItem);
  }

  async function syncData(token) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    const { localTimestamp } = await browser.storage.local.get('localTimestamp') || 0;
    const serverTimestamp = await _getServerFileTimestamp(token, syncFileId);
    if (serverTimestamp === undefined || serverTimestamp === false) {
        if (localTimestamp === 0) { return; }
        await createNewSyncFileAndBackup(token);
        await updateRemote(token);
        return;
    }
    if (serverTimestamp > localTimestamp) {
        const tabsArray = await _loadSettingsFile(token, syncFileId);
        await browser.storage.local.set({ tabsArray });
    } else {
        await updateRemote(token);
    }
  }