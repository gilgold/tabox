import React, { useState, useEffect } from 'react'
import { useRecoilState, useRecoilValue } from 'recoil';
import { syncInProgressState, themeState, isLoggedInState, lastSyncTimeState } from './atoms/globalAppSettingsState';
import './Footer.css';
import { browser } from '../static/globals';
import TimeAgo from 'javascript-time-ago';
import ReactTimeAgo from 'react-time-ago';
import en from 'javascript-time-ago/locale/en';
import { RiTwitterXLine } from 'react-icons/ri';
import { FaFacebook } from 'react-icons/fa';
import { BiSync } from 'react-icons/bi';

function DarkModeSwitch() {
  const [themeMode, setThemeMode] = useRecoilState(themeState);
  const [switchLabelState, setSwitchLabelState] = useState('out');
  const [checked, setChecked] = useState(false);

  useEffect(async () => {
    const { theme } = await browser.storage.local.get('theme');
    const isDark = theme === 'dark';
    setChecked(isDark);
    setSwitchLabelState(isDark ? 'out' : 'over')
  }, [])

  const toggle = () => {
    setChecked(!checked);
    setSwitchLabelState(switchLabelState === 'over' ? 'out' : 'over')
    const newMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(newMode);
    document.documentElement.setAttribute('data-theme', newMode);
  }

  return <div className="theme-switch-wrapper">
    <div className={`circle ${switchLabelState}`}>
      <input type="checkbox" onChange={toggle} id="chkDarkMode" checked={checked} />
      <label className={`theme-switch`} htmlFor="chkDarkMode"></label>
      <span key={`key-${switchLabelState}`} className={`theme-switch-inner-circle`} onClick={() => toggle()}></span>
      <div className="half">
      </div>
    </div>
    
    <span className="dark_mode_switch_label" onClick={() => toggle()}> Dark Mode: <span id="darkModeState">{themeMode === 'dark' ? 'on' : 'off'}</span></span>
  </div>
}

function SyncLabel() {
  const syncInProgress = useRecoilValue(syncInProgressState);
  const isLoggedIn = useRecoilValue(isLoggedInState);
  const lastSyncTime = useRecoilValue(lastSyncTimeState);

  useEffect(() => {
    TimeAgo.addDefaultLocale(en);
  }, []);

  const msg = syncInProgress ? 'syncing...' : <ReactTimeAgo date={lastSyncTime ?? Date.now()} locale="en-US" timeStyle="round"/>

  return <span id="last_sync">
    <BiSync 
      className={`sync_dark ${syncInProgress ? 'rotate' : ''}`} 
      key={`syncImg-${syncInProgress}`} 
      id="syncImg" /> <span className="sync_msg">{ isLoggedIn ? msg : `Sync Disabled` }</span>
  </span>
}

function Footer() {
  return <footer id="footer">
      <div className="footer_left">
        <DarkModeSwitch />
        <SyncLabel />
      </div>
      <div className="header_title">
        Tabox<br />
        <span className="version">version {browser.runtime.getManifest().version}</span>
      </div>
      <span className="right_footer">
        <div className="footer_icons">
          <a href="https://twitter.com/Taboxapp" target="_blank" rel="noreferrer">
            <RiTwitterXLine className="social_icon twitter" />
          </a> 
          <a href="https://www.facebook.com/taboxext" target="_blank" rel="noreferrer">
            <FaFacebook className="social_icon facebook" />
          </a>
        </div>
        <a href="http://tabox.co" target="_blank" rel="noreferrer">www.tabox.co</a>
      </span>
    </footer>;
}

export default Footer;