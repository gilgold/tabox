import './App.css';
import React, { useEffect } from 'react';
import Header from './Header';
import AddNewTextbox from './AddNewTextbox';
import ImportCollection from './ImportCollection';
import CollectionList from './CollectionList';
import Footer from './Footer';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { settingsDataState } from './atoms/settingsDataState';
import { applyUid, convertOldDataToNewFormat } from './utils';
import { 
  isHighlightedState, 
  themeState, 
  isLoggedInState,
  syncInProgressState,
  lastSyncTimeState,
} from './atoms/globalAppSettingsState';
import { browser } from '../static/globals';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import ReopenLastSession from './ReopenLastSession';
import ReactTooltip from 'react-tooltip';
import { CollectionListOptions } from './CollectionListOptions';

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
      openSnackbar('Error syncing data, please login again', 6000);
  }

  const logout = async () => {
    browser.runtime.sendMessage({type: 'logout'}).then((response) => {
      setIsLoggedIn(false);
    })
  };

  const applyDataFromServer = async (force = false) => {
    setSyncInProgress(true);
    browser.runtime.sendMessage({type: 'loadFromServer', force: force}).then((response) => {
      if (response !== false) {
        setSettingsData(response);
        setLastSyncTime(Date.now());
        loadCollectionsFromStorage();
      }
      setSyncInProgress(false);
    }).catch(async (err) => {
      await _handleSyncError(err)
    });
  }

  const _update = async () => {
    setSyncInProgress(true);
    browser.runtime.sendMessage({type: 'updateRemote'}).then((response) => {
      setSyncInProgress(false);
      setLastSyncTime(Date.now());
    }).catch(async (err) => {
      setSyncInProgress(false);
      await _handleSyncError(err)
    });
  }

  const updateRemoteData = async (newData) => {
    await browser.storage.local.set({localTimestamp: Date.now()});
    setSettingsData(newData);
    if (!isLoggedIn) return;
    _update();
  }

  const loadCollectionsFromStorage = async () => {
    const {tabsArray} = await browser.storage.local.get('tabsArray');
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
  
  useEffect(async () => {
    await convertOldDataToNewFormat();
    await checkSyncStatus();
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
      <Header applyDataFromServer={applyDataFromServer} updateRemoteData={updateRemoteData} logout={logout} />
      <div className="main-content-wrapper">
        <AddNewTextbox updateRemoteData={updateRemoteData} />
        <ImportCollection updateRemoteData={updateRemoteData} />
        <Divder/>
        <CollectionListOptions updateRemoteData={updateRemoteData} />
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
