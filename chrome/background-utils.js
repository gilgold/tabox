
let lastValidated = 0;

function applyChromeGroupSettings(tabs, windowId, collection) {
    if (!collection.chromeGroups) {
      return;
    }
    collection.chromeGroups.forEach((chromeGroup) => {
      const tabsToGroup = tabs.filter(({groupId}) => chromeGroup.id === groupId).map((t) => t.newTabId);
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
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', options);
    if (tokenResponse.status >= 400) return -1;
    const data = await tokenResponse.json();
    await browser.storage.local.set({ googleToken: data.access_token });
    return data.access_token;
}

async function getAuthToken() {
    const { googleToken } = await browser.storage.local.get('googleToken');
    if (googleToken) {
        if (Date.now() - lastValidated < 5000) return googleToken;
        console.log('validating existing token')
        const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${googleToken}`);
        console.log(`token is: ${response.status}`);
        lastValidated = Date.now();
        if (response.status < 400) return googleToken;
    }
    const newToken = await getNewAccessToken();
    // if (newToken === -1) throw new Error('Refresh token no longer valid');
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
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/about?alt=json&fields=user&prettyPrint=false&key=${googleApiKey}`,
        init)
    if (response.status >= 400) {
        return null;
    }
    const data = await response.json();
    await browser.storage.local.set({ googleUser: data.user });
    return data.user;
}

async function removeToken(token) {
    const _token = token === -1 ? (await browser.storage.local.get('googleToken')).googleToken : token;
    const url = 'https://accounts.google.com/o/oauth2/revoke?token=' + _token;
    await browser.storage.local.remove('googleToken');
    if (_token) await fetch(url);
}

async function getOrCreateSyncFile(token) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    if (syncFileId) return;
    console.log('searching for sync file on server')
    const url = "https://www.googleapis.com/drive/v3/files/?corpora=user&spaces=appDataFolder&fields=files(id)&q=name='appSettings.json'&pageSize=1&orderBy=modifiedByMeTime desc";
    const response = await fetch(url, {
        mode: 'cors',
        withCredentials: true,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    if (response.status >= 400) {
        return null;
    }
    const data = await response.json();
    if (data.files.length === 0) {
        await _createNewSyncFile(token);
    } else {
        await browser.storage.sync.set({ syncFileId: data.files[0].id });
    }
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
    console.log('creating new sync file')
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', init);
    if (response.status >= 400) {
        return null;
    }
    const data = await response.json();
    await browser.storage.sync.set({ syncFileId: data.id });
    return data.id;
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
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=json&fields=modifiedByMeTime`, init);
    const { modifiedByMeTime } = await response.json();
    return Date.parse(modifiedByMeTime);
}

async function updateRemote(token, tabsArray) {
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
    const response = await fetch(url, init);
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
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, init);
    const data = await response.json();
    await browser.storage.local.set({ settings: data.settings });
    let serverData;
    if (data.tabsArray) {
        serverData = data.tabsArray === null ? [] : data.tabsArray;
    } else if (data.settings) {
        await convertOldDataToNewFormat();
        const { tabsArray } = await browser.storage.local.get('tabsArray');
        serverData = tabsArray;
    }
    await browser.storage.local.set({ localTimestamp: Date.now() });
    return serverData;
}

async function updateLocalDataFromServer(token) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    const serverTimestamp = await _getServerFileTimestamp(token, syncFileId);
    let { localTimestamp } = await browser.storage.local.get('localTimestamp');
    localTimestamp = localTimestamp ?? 0;
    console.log(`Comparing timestamps, remote is: ${(serverTimestamp > localTimestamp) ? 'newer' : 'older'}`)
    if (serverTimestamp > localTimestamp) return await _loadSettingsFile(token, syncFileId);
    return false;
}

function _tokenArgs(code) {
    const redirectURL = browser.identity.getRedirectURL();
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    return {
        code: code,
        client_id: clientId,
        client_secret: 'owJvtMCOPyVXXvcNStFJC2eO',
        grant_type: 'authorization_code',
        redirect_uri: redirectURL,
    }
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
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', options);
    const data = await tokenResponse.json();
    await browser.storage.local.set({ googleToken: data.access_token, googleRefreshToken: data.refresh_token });
    return data.access_token;
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