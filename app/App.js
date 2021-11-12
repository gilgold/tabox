/* eslint-disable no-useless-escape */
import './App.css';
import React, { useEffect, useMemo } from 'react';
import Header from './Header';
import AddNewTextbox from './AddNewTextbox';
import ImportCollection from './ImportCollection';
import CollectionList from './CollectionList';
import Footer from './Footer';
import { useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
import { settingsDataState } from './atoms/settingsDataState';
import { applyUid, convertOldDataToNewFormat } from './utils';
import {
  isHighlightedState,
  themeState,
  isLoggedInState,
  syncInProgressState,
  lastSyncTimeState,
  searchState,
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
  const setIsHighlighted = useSetRecoilState(isHighlightedState);
  const [themeMode, setThemeMode] = useRecoilState(themeState);
  const [isLoggedIn, setIsLoggedIn] = useRecoilState(isLoggedInState);
  const setSyncInProgress = useSetRecoilState(syncInProgressState);
  const setLastSyncTime = useSetRecoilState(lastSyncTimeState);
  const [openSnackbar] = useSnackbar({ style: SnackbarStyle.ERROR });
  const search = useRecoilValue(searchState);

  const applyTheme = async () => {
    let { theme } = await browser.storage.local.get('theme');
    theme = theme ? theme : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setThemeMode(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  const checkSyncStatus = async () => {
    console.log('check sync status')
    const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
    const { googleUser } = await browser.storage.local.get('googleUser');
    if (!googleRefreshToken || !googleUser) return;
    browser.runtime.sendMessage({ type: 'checkSyncStatus' }).then(async (response) => {
      if (response === false) throw new Error('Refresh token is no longer valid');
      setIsLoggedIn(response !== null);
      await applyDataFromServer();
    }).catch(async (error) => {
      console.log('checkSyncStatus error', error);
      setIsLoggedIn(false);
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
    console.log('_update');
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
    console.log('updateRemoteData');
    await browser.storage.local.set({ localTimestamp: Date.now() });
    if (!isLoggedIn) return;
    _update();
  }

  const updateCollection = async (index, newCollection) => {
    const newList = [...settingsData];
    newList[index] = newCollection;
    await updateRemoteData(newList);
  }

  const removeCollectionAtIndex = (index) => {
    return [...settingsData.slice(0, index), ...settingsData.slice(index + 1)];
  }

  const addCollection = async (newCollection) => {
    const newList = settingsData ? [newCollection, ...settingsData] : [newCollection];
    setRowToHighlight(0);
    await updateRemoteData(newList);
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

  const checkForHighlightedTabs = async () => {
    const tabs = await browser.tabs.query({ currentWindow: true, highlighted: true })
    setIsHighlighted(tabs && tabs.length > 1);
  }

  useEffect(async () => {
    await convertOldDataToNewFormat();
    await checkSyncStatus();
    await loadCollectionsFromStorage();
    await applyTheme();
    await checkForHighlightedTabs();
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
      <AddNewTextbox addCollection={addCollection} />
      <ImportCollection updateRemoteData={updateRemoteData} />
      <Divder />
      <CollectionListOptions updateRemoteData={updateRemoteData} />
      <Divder />
      <CollectionList
        updateRemoteData={updateRemoteData}
        collections={collectionsToShow}
        updateCollection={updateCollection}
        removeCollectionAtIndex={removeCollectionAtIndex} />
      <Divder />
      <ReopenLastSession />
    </div>
    <Footer />
  </div>;
}

export default App;
