/* eslint-disable no-useless-escape */
import './App.css';
import React, { useEffect, useMemo, useState } from 'react';
import Header from './Header';
import AddNewTextbox from './AddNewTextbox';
import CollectionList from './CollectionList';
import Footer from './Footer';
import { useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
import { settingsDataState } from './atoms/globalAppSettingsState';
import { applyUid } from './utils';
import {
  themeState,
  isLoggedInState,
  syncInProgressState,
  lastSyncTimeState,
  searchState,
  listKeyState,
} from './atoms/globalAppSettingsState';
import { rowToHighlightState } from './atoms/animationsState';
import { browser } from '../static/globals';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import ReopenLastSession from './ReopenLastSession';
import ReactTooltip from 'react-tooltip';
import { CollectionListOptions } from './CollectionListOptions';

const Divder = () => <div className='hr' />;

function App() {
  const [settingsData, setSettingsData] = useRecoilState(settingsDataState);
  const setRowToHighlight = useSetRecoilState(rowToHighlightState);
  const [themeMode, setThemeMode] = useRecoilState(themeState);
  const [isLoggedIn, setIsLoggedIn] = useRecoilState(isLoggedInState);
  const setSyncInProgress = useSetRecoilState(syncInProgressState);
  const setLastSyncTime = useSetRecoilState(lastSyncTimeState);
  const [openSnackbar] = useSnackbar({ style: SnackbarStyle.ERROR });
  const search = useRecoilValue(searchState);
  const [listKey, setListKey] = useRecoilState(listKeyState);
  const [sortValue, setSortValue] = useState(null);

  const removeInactiveWindowsFromAutoUpdate = async () => {
    let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
    const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
    if (!collectionsToTrack || collectionsToTrack.length === 0 || !chkEnableAutoUpdate) { return; }
    const activeWindowIds = (await browser.windows.getAll({ populate: false })).map(c => c.id);
    collectionsToTrack = collectionsToTrack.filter(c => activeWindowIds.includes(c.windowId));
    console.log('collectionsToTrack', collectionsToTrack);
    await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
  }

  const applyTheme = async () => {
    let { theme } = await browser.storage.local.get('theme');
    theme = theme ? theme : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setThemeMode(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  const checkSyncStatus = async () => {
    console.log('check sync status')
    const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
    if (!googleRefreshToken) return;
    browser.runtime.sendMessage({ type: 'checkSyncStatus' }).then(async (response) => {
      setIsLoggedIn(response === null ? false : response);
      if (response) await applyDataFromServer();
    });
  }

  const _handleSyncError = async () => {
    await browser.storage.local.remove('googleToken');
    await browser.storage.local.remove('googleUser');
    setIsLoggedIn(false);
    openSnackbar('Error syncing data, please enable sync again', 6000);
  }

  const logout = async () => {
    browser.runtime.sendMessage({ type: 'logout' }).then(() => {
      setIsLoggedIn(false);
    })
  };

  const applyDataFromServer = async (force = false) => {
    setSyncInProgress(true);
    browser.runtime.sendMessage({ type: 'loadFromServer', force: force }).then((response) => {
      if (response !== false) {
        setSettingsData(response);
        setLastSyncTime(Date.now());
      }
    }).catch(async (err) => {
      await _handleSyncError(err)
    }).finally(() => {
      setSyncInProgress(false);
    });
  }

  const _update = async () => {
    setSyncInProgress(true);
    console.log('Update remote data');
    browser.runtime.sendMessage({ type: 'updateRemote' }).then(() => {
      setLastSyncTime(Date.now());
    }).catch(async (err) => {
      await _handleSyncError(err)
    }).finally(() => {
      setSyncInProgress(false);
    });
  }

  const updateRemoteData = async (newData) => {
    setSettingsData(newData);
    await browser.storage.local.set({ localTimestamp: Date.now() });
    await browser.runtime.sendMessage({ type: 'addCollection' });
    if (!isLoggedIn) return;
    _update();
  }

  const updateCollection = async (newCollection) => {
    const newList = [...settingsData];
    const index = newList.findIndex(c => c.uid === newCollection.uid);
    newList[index] = newCollection;
    await updateRemoteData(newList);
  }

  const removeCollection = (collectionUid) => {
    return [...settingsData].filter(c => c.uid !== collectionUid);
  }

  const addCollection = async (newCollection) => {
    const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
    setRowToHighlight(0);
    await updateRemoteData(newList);
    const { chkAutoUpdateOnNewCollection } = await browser.storage.local.get('chkAutoUpdateOnNewCollection');
    if (!chkAutoUpdateOnNewCollection) return;
    setTimeout(async () => {
      let { collectionsToTrack } = (await browser.storage.local.get('collectionsToTrack')) || [];
      const window = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
      const index = collectionsToTrack.findIndex(c => c.collectionUid === newCollection.uid);
      if (index !== undefined && index > -1) {
          collectionsToTrack[index].windowId = window.id;
      } else {
          collectionsToTrack.push({
              collectionUid: newCollection.uid,
              windowId: window.id
          });
      }
      await browser.storage.local.set({ collectionsToTrack });
      setListKey(Math.random().toString(36));
    }, 1000);
  }

  const loadCollectionsFromStorage = async () => {
    const { tabsArray } = await browser.storage.local.get('tabsArray');
    let newCollections = [];
    if (tabsArray && tabsArray.length > 0) {
      tabsArray.forEach((collection) => {
        if (collection.tabs && collection.tabs.length > 0 && !('uid' in collection.tabs[0])) {
          const taboxItem = applyUid(collection);
          newCollections.push(taboxItem);
        } else {
          newCollections.push(collection);
        }
      });
    }
    setSettingsData(newCollections);
  }

  const getSelectedSort = async () => {
    const { currentSortValue } = await browser.storage.local.get('currentSortValue');
    setSortValue(currentSortValue);
  }

  useEffect(() => {
    if (isLoggedIn) loadCollectionsFromStorage();
  }, [isLoggedIn]);

  useEffect(async () => {
    await applyTheme();
    await getSelectedSort();
    await removeInactiveWindowsFromAutoUpdate();
    await checkSyncStatus();
    await loadCollectionsFromStorage();
  }, []);

  const escapeRegex = string => {
    return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  const collectionsToShow = useMemo(() => {
    if (!search || !search.trim() || !settingsData) return settingsData;
    const searchRegex = new RegExp(escapeRegex(search), 'i');
    return settingsData.filter(collection => collection.name.match(searchRegex));
  }, [
    search,
    settingsData,
  ]);

  return <div className="App">
    <ReactTooltip
      event={'mouseover'}
      eventOff={'click mouseout'}
      delayShow={200}
      type={themeMode === 'light' ? 'dark' : 'light'} />
    <Header
      applyDataFromServer={applyDataFromServer}
      updateRemoteData={updateRemoteData}
      logout={logout} />
    <div className="main-content-wrapper">
      <AddNewTextbox addCollection={addCollection} updateRemoteData={updateRemoteData} />
      <Divder />
      <CollectionListOptions 
        key={`${sortValue}-select`}
        updateRemoteData={updateRemoteData} 
        selected={sortValue}
      />
      <Divder />
      <CollectionList
        key={`collection-list-${listKey}`}
        updateRemoteData={updateRemoteData}
        collections={collectionsToShow}
        updateCollection={updateCollection}
        removeCollection={removeCollection} />
      <Divder />
      <ReopenLastSession addCollection={addCollection} />
    </div>
    <Footer />
  </div>;
}

export default App;
