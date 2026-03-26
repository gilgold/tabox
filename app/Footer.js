import React from 'react'
import { useAtomValue } from 'jotai';
import { syncInProgressState, isLoggedInState, lastSyncTimeState } from './atoms/globalAppSettingsState';
import './Footer.css';
import { browser } from '../static/globals';
import ReactTimeAgo from 'react-time-ago';
import { RiTwitterXLine } from 'react-icons/ri';
import { FaFacebook } from 'react-icons/fa';

function SyncLabel() {
  const syncInProgress = useAtomValue(syncInProgressState);
  const isLoggedIn = useAtomValue(isLoggedInState);
  const lastSyncTime = useAtomValue(lastSyncTimeState);

  const dotClass = !isLoggedIn
    ? 'disconnected'
    : syncInProgress ? 'syncing' : 'connected';

  const msg = syncInProgress
    ? 'syncing...'
    : <ReactTimeAgo date={lastSyncTime ?? Date.now()} locale="en-US" timeStyle="round" tick />;

  return <span id="last_sync">
    <span className={`footer-sync-dot ${dotClass}`} />
    <span className="sync_msg">{ isLoggedIn ? msg : 'Sync Disabled' }</span>
  </span>
}

function Footer() {
  return <footer id="footer">
      <div className="footer_left">
        <SyncLabel />
      </div>
      <div className="footer_center">
        <span className="tabox-gradient">Tabox</span>
        <span className="version">{browser.runtime.getManifest().version}</span>
      </div>
      <div className="footer_right">
        <div className="footer_icons">
          <a href="https://twitter.com/Taboxapp" target="_blank" rel="noreferrer">
            <RiTwitterXLine className="social_icon twitter" />
          </a> 
          <a href="https://www.facebook.com/taboxext" target="_blank" rel="noreferrer">
            <FaFacebook className="social_icon facebook" />
          </a>
        </div>
      </div>
    </footer>;
}

export default Footer;
