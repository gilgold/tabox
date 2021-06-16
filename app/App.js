import './App.css';
import React, { useEffect, useState } from 'react';
import Header from './Header';
import AddNewTextbox from './AddNewTextbox';
import ImportCollection from './ImportCollection';
import CollectionList from './CollectionList';
import Footer from './Footer';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { settingsDataState } from './atoms/settingsDataState';
import { convertOldDataToNewFormat } from './utils';
import { 
  isHighlightedState, 
  themeState, 
  isLoggedInState,
  syncInProgressState,
  lastSyncTimeState,
} from './atoms/globalAppSettingsState';
import { browser } from '../static/index';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import ReopenLastSession from './ReopenLastSession';
import TaboxGroupItem from './model/TaboxGroupItem';
import ReactTooltip from 'react-tooltip';

const Divder = () => <div className='hr'></div>;

function App() {
  const [settingsData, setSettingsData] = useRecoilState(settingsDataState);
  const setIsHighlighted = useSetRecoilState(isHighlightedState);
  const [themeMode, setThemeMode] = useRecoilState(themeState);
  const [isLoggedIn, setIsLoggedIn] = useRecoilState(isLoggedInState);
  const [syncInProgress, setSyncInProgress] = useRecoilState(syncInProgressState);
  const setLastSyncTime = useSetRecoilState(lastSyncTimeState);
  const [openSnackbar, closeSnackbar] = useSnackbar({style: SnackbarStyle.ERROR});

  const applyTheme = (theme) => {
    setThemeMode(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  const checkSyncStatus = async () => {
    console.log('check sync status')
    try {
      const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
      if (!googleRefreshToken) return;
      browser.runtime.sendMessage({type: 'checkSyncStatus'}).then(async (response) => {
        if (response === false) throw new Error('Refresh token is no longer valid');
        setIsLoggedIn(response !== null);
        await applyDataFromServer();
      }).catch(async (err) => {
        await _handleSyncError(err)
      });
    } catch (e) {
      await _handleSyncError(e);
    }
  }

  const _handleSyncError = async (e) => {
      await logout();
      console.log(e)
      openSnackbar('Error syncing data, please login again', 6000);
  }

  const logout = async () => {
    browser.runtime.sendMessage({type: 'logout'}).then((response) => {
      setIsLoggedIn(false);
    })
  };

  const applyDataFromServer = async () => {
    setSyncInProgress(true);
    browser.runtime.sendMessage({type: 'loadFromServer'}).then((response) => {
      if (response !== false) {
        setSettingsData(response);
        setLastSyncTime(Date.now());
      }
      setSyncInProgress(false);
    }).catch(async (err) => {
      await _handleSyncError(err)
    });
  }

  const updateRemoteData = async (newData, overrideLoginCheck = false) => {
    setSettingsData(newData);
    await browser.storage.local.set({localTimestamp: Date.now()});
    if (!isLoggedIn && !overrideLoginCheck) return;
    setSyncInProgress(true);
    browser.runtime.sendMessage({type: 'updateRemote', newData: newData}).then((response) => {
      setLastSyncTime(Date.now());
      setSyncInProgress(false);
    }).catch(async (err) => {
      await _handleSyncError(err)
    });
    
  }

  const loadCollectionsFromStorage = async () => {
    const {tabsArray} = await browser.storage.local.get('tabsArray');
    let newCollections = [];
    if (tabsArray) {
      tabsArray.forEach((collection) => {
        let taboxItem = new TaboxGroupItem(collection.name, collection.tabs, collection.chromeGroups, collection.color, collection.createdOn);
        newCollections.push(taboxItem);
      });
    }
    setSettingsData(newCollections);
  }
  
  useEffect(async () => {
    await convertOldDataToNewFormat();
    checkSyncStatus();
    await loadCollectionsFromStorage();
    
    const {theme} = await browser.storage.local.get('theme');
    let currentTheme = theme;
    if (!currentTheme) currentTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(currentTheme);
    const tabs = await browser.tabs.query({currentWindow:true, highlighted: true})
    setIsHighlighted(tabs.length > 1);
  }, []);

  return <div className="App">
      <ReactTooltip 
        event={'mouseover'} 
        eventOff={'click mouseout'} 
        delayShow={200}
        type={themeMode === 'light' ? 'dark' : 'light'} />
      <Header applyDataFromServer={applyDataFromServer} logout={logout} />
      <div className="main-content-wrapper">
        <AddNewTextbox updateRemoteData={updateRemoteData} />
        <ImportCollection updateRemoteData={updateRemoteData} />
        <Divder/>
        <CollectionList 
          updateRemoteData={updateRemoteData}  
          collections={settingsData} />
        <Divder/>
        <ReopenLastSession/>
      </div>
      <Footer />
    </div>;

}

export default App;
