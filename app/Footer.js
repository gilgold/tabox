import React, { useState, useEffect } from 'react'
import { useRecoilState, useRecoilValue } from 'recoil';
import { syncInProgressState, themeState, isLoggedInState, lastSyncTimeState } from './atoms/globalAppSettingsState';
import './Footer.css';
import { browser } from '../static/index';
import TimeAgo from 'javascript-time-ago';
import ReactTimeAgo from 'react-time-ago';
import en from 'javascript-time-ago/locale/en'

function DarkModeSwitch(props) {
  const [themeMode, setThemeMode] = useRecoilState(themeState);
  const [switchLabelState, setSwitchLabelState] = useState('out');
  const [checked, setChecked] = useState(false);

  useEffect(async () => {
    const {theme} = await browser.storage.local.get('theme');
    const isDark = theme === 'dark';
    setChecked(isDark);
    setSwitchLabelState(isDark ? 'out' : 'over')
  }, [])

  const toggle = (event) => {
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

function SyncLabel(props) {
  const syncInProgress = useRecoilValue(syncInProgressState);
  const isLoggedIn = useRecoilValue(isLoggedInState);
  const lastSyncTime = useRecoilValue(lastSyncTimeState);

  useEffect(() => {
    TimeAgo.addDefaultLocale(en);
  }, []);
  const msg = syncInProgress ? 'syncing...' : <ReactTimeAgo date={lastSyncTime ?? Date.now()} locale="en-US" timeStyle="round"/>

  return <span id="last_sync">
    <svg key={`syncImg-${syncInProgress}`} id="syncImg" width="20" height="28" viewBox="0 0 20 28" className={`sync_dark ${syncInProgress ? 'rotate' : ''}`} xmlns="http://www.w3.org/2000/svg">
      <path d="M10 4V0.25L5 5.25L10 10.25V6.5C14.1375 6.5 17.5 9.8625 17.5 14C17.5 15.2625 17.1875 16.4625 16.625 17.5L18.45 19.325C19.425 17.7875 20 15.9625 20 14C20 8.475 15.525 4 10 4ZM10 21.5C5.8625 21.5 2.5 18.1375 2.5 14C2.5 12.7375 2.8125 11.5375 3.375 10.5L1.55 8.675C0.575 10.2125 0 12.0375 0 14C0 19.525 4.475 24 10 24V27.75L15 22.75L10 17.75V21.5Z"></path>
    </svg> <span className="sync_msg">{ isLoggedIn ? msg : `Sync Disabled` }</span>
  </span>
}

function Footer(props) {
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
          <a href="https://twitter.com/Taboxapp" target="_blank">
            <svg version="1.1" x="0px" y="0px" viewBox="0 0 400 400" style={{
            enableBackground: 'new 0 0 400 400'
          }}>
            <g id="_x31_0_x2013_20_x25__Black_Tint">
              <rect className="st0" width="400" height="400"></rect>
            </g>
            <g id="Logo__x2014__FIXED">
              <g>
                <path className="social_icon twitter" d="M153.6,301.6c94.3,0,145.9-78.2,145.9-145.9c0-2.2,0-4.4-0.1-6.6c10-7.2,18.7-16.3,25.6-26.6
                  c-9.2,4.1-19.1,6.8-29.5,8.1c10.6-6.3,18.7-16.4,22.6-28.4c-9.9,5.9-20.9,10.1-32.6,12.4c-9.4-10-22.7-16.2-37.4-16.2
                  c-28.3,0-51.3,23-51.3,51.3c0,4,0.5,7.9,1.3,11.7c-42.6-2.1-80.4-22.6-105.7-53.6c-4.4,7.6-6.9,16.4-6.9,25.8
                  c0,17.8,9.1,33.5,22.8,42.7c-8.4-0.3-16.3-2.6-23.2-6.4c0,0.2,0,0.4,0,0.7c0,24.8,17.7,45.6,41.1,50.3c-4.3,1.2-8.8,1.8-13.5,1.8
                  c-3.3,0-6.5-0.3-9.6-0.9c6.5,20.4,25.5,35.2,47.9,35.6c-17.6,13.8-39.7,22-63.7,22c-4.1,0-8.2-0.2-12.2-0.7
                  C97.7,293.1,124.7,301.6,153.6,301.6"></path>
              </g>
            </g>
            </svg>
          </a> 
          <a href="https://www.facebook.com/taboxext" target="_blank">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="social_icon facebook">
              <path d="M24 5A19 19 0 1 0 24 43A19 19 0 1 0 24 5Z"></path>
              <path className="facebook_f" d="M26.572,29.036h4.917l0.772-4.995h-5.69v-2.73c0-2.075,0.678-3.915,2.619-3.915h3.119v-4.359c-0.548-0.074-1.707-0.236-3.897-0.236c-4.573,0-7.254,2.415-7.254,7.917v3.323h-4.701v4.995h4.701v13.729C22.089,42.905,23.032,43,24,43c0.875,0,1.729-0.08,2.572-0.194V29.036z"></path>
            </svg>
          </a>
        </div>
        <a href="http://tabox.co" target="_blank">www.tabox.co</a>
      </span>
    </footer>;
};

export default Footer;