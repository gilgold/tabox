import React, { useState, useRef, useEffect, lazy, Suspense } from 'react'
import './Header.css';
import {
    isLoggedInState,
    syncInProgressState,
    lastSyncTimeState,
    syncSessionStateState,
} from './atoms/globalAppSettingsState';
import { useAtom, useAtomValue } from 'jotai';
import { browser } from '../static/globals';
import { openOrFocusFullPageInCurrentWindow } from './utils/openFullPage';
import TabSwitcherButton from './TabSwitcherButton';
import { showSuccessToast } from './toastHelpers';
import { MdOpenInNew, MdLogout, MdSync } from 'react-icons/md';
import ReactTimeAgo from 'react-time-ago';

const SettingsMenu = lazy(() => import('./SettingsMenu'));

function SyncStatus({ onTriggerSync }) {
    const syncInProgress = useAtomValue(syncInProgressState);
    const isLoggedIn = useAtomValue(isLoggedInState);
    const lastSyncTime = useAtomValue(lastSyncTimeState);
    const syncSessionState = useAtomValue(syncSessionStateState);
    const syncStatus = syncSessionState?.status;
    const canTriggerSync = Boolean(onTriggerSync) && isLoggedIn && !syncInProgress && syncStatus !== 'syncing';

    const dotClass = !isLoggedIn
        ? 'disconnected'
        : (syncInProgress || syncStatus === 'syncing')
            ? 'syncing'
            : 'connected';
    const tooltipContent = !isLoggedIn
        ? 'Sync disabled'
        : syncInProgress || syncStatus === 'syncing'
            ? 'Syncing...'
            : syncStatus === 'auth_refreshing'
                ? 'Sync is reconnecting'
                : syncStatus === 'auth_required'
                    ? 'Sync needs your attention'
                    : syncStatus === 'sync_file_error' || syncStatus === 'user_info_error' || syncStatus === 'error'
                        ? 'Sync has an issue'
                        : 'Sync enabled';
    const label = !isLoggedIn
        ? 'Sync off'
        : syncInProgress || syncStatus === 'syncing'
            ? 'syncing...'
            : syncStatus === 'auth_refreshing'
                ? 'reconnecting...'
                : syncStatus === 'auth_required'
                    ? 'auth required'
                    : syncStatus === 'sync_file_error' || syncStatus === 'user_info_error' || syncStatus === 'error'
                        ? 'sync issue'
                        : null;

    return (
        <div className="sync-status"
             data-tooltip-id="main-tooltip"
             data-tooltip-content={tooltipContent}>
            <span className={`sync-dot ${dotClass}`} />
            <span className="sync-label">
                {label || <ReactTimeAgo date={lastSyncTime ?? Date.now()} locale="en-US" timeStyle="round" tick />}
            </span>
            {onTriggerSync ? (
                <button
                    type="button"
                    className="sync-status-action"
                    onClick={onTriggerSync}
                    disabled={!canTriggerSync}
                    aria-label="Sync now"
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={canTriggerSync ? 'Sync now' : tooltipContent}
                >
                    <MdSync size={14} />
                </button>
            ) : null}
        </div>
    );
}

function LoginSection(props) {
    const [isLoggedIn, setIsLoggedIn] = useAtom(isLoggedInState);
    const syncSessionState = useAtomValue(syncSessionStateState);
    const googleUser = syncSessionState?.user || null;
    const isRecovering = isLoggedIn && !googleUser && Boolean(syncSessionState?.hasRefreshToken);
    const isSyncIssue = isLoggedIn && ['auth_required', 'sync_file_error', 'user_info_error', 'error'].includes(syncSessionState?.status);

    const handleClick = async () => {
        if (isLoggedIn) {
            await props.logout();
            showSuccessToast('Sync has been disabled')
        } else {
            browser.runtime.sendMessage({ type: 'login' }).then(async (response) => {
                if (response === false) return;
                setIsLoggedIn(true);
                showSuccessToast('Sync is now enabled!');
            });
        }
    }

    const firstName = isLoggedIn && googleUser?.displayName
        ? googleUser.displayName.split(' ')[0]
        : null;

    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    const handleLogout = async () => {
        setMenuOpen(false);
        await props.logout();
        showSuccessToast('Sync has been disabled');
    };

    if (props.compact) {
        const handleCompactClick = async () => {
            if (isLoggedIn && googleUser) {
                setMenuOpen(prev => !prev);
            } else if (isRecovering || isSyncIssue) {
                await browser.runtime.sendMessage({ type: 'checkSyncStatus' });
            } else {
                await handleClick();
            }
        };

        return (
            <div className="login-section login-section-compact" ref={menuRef}>
                <div className="compact-user-trigger"
                     title={
                         isLoggedIn && googleUser
                             ? googleUser.emailAddress
                             : isRecovering
                                 ? 'Sync is reconnecting'
                                 : isSyncIssue
                                     ? 'Sync needs your attention'
                                     : 'Click to enable Google Drive sync'
                     }
                     onClick={handleCompactClick}>
                    <div className="avatar-wrapper">
                        <img id="avatar" className="avatar"
                             src={isLoggedIn && googleUser?.photoLink ? googleUser.photoLink : '/images/not_signed_in.png'}
                             alt="user avatar" />
                    </div>
                    <span className="header_text">
                        {firstName ? `Hello, ${firstName}` : isRecovering ? 'Sync reconnecting' : isSyncIssue ? 'Sync needs attention' : 'Sign in'}
                    </span>
                </div>
                {menuOpen && (
                    <div className="user-context-menu">
                        <div className="user-context-header">
                            <div className="user-context-name">{googleUser.displayName}</div>
                            <div className="user-context-email">{googleUser.emailAddress}</div>
                        </div>
                        <div className="user-context-divider" />
                        <button className="user-context-item" onClick={handleLogout}>
                            <MdLogout size={14} />
                            <span>Disconnect sync</span>
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="login-section"
             title={isLoggedIn && googleUser ? 'Click here to disable Google Drive sync' : isRecovering ? 'Sync is reconnecting' : isSyncIssue ? 'Sync needs your attention' : 'Click here to enable Google Drive sync'}
             onClick={async () => {
                 if (isRecovering || isSyncIssue) {
                     await browser.runtime.sendMessage({ type: 'checkSyncStatus' });
                     return;
                 }

                 await handleClick();
             }}>
            <div className="avatar-wrapper">
                <img id="avatar" className="avatar"
                     src={isLoggedIn && googleUser && googleUser.photoLink ? googleUser.photoLink : '/images/not_signed_in.png'}
                     alt="user avatar" />
            </div>
            {isLoggedIn && googleUser ? (
                <div className="user-info">
                    <div className="header_text">
                        Sync enabled for {googleUser.displayName}
                    </div>
                    <div className="email">
                        {googleUser.emailAddress}
                    </div>
                </div>
            ) : isRecovering ? (
                <div className="user-info">
                    <div className="header_text">
                        Sync reconnecting
                    </div>
                    <div className="email">
                        Checking your Google session
                    </div>
                </div>
            ) : isSyncIssue ? (
                <div className="user-info">
                    <div className="header_text">
                        Sync needs attention
                    </div>
                    <div className="email">
                        {syncSessionState?.error || 'Click to re-check your sync session'}
                    </div>
                </div>
            ) : <span className="header_text">Signin with Google to enable sync</span>}
        </div>
    );
}

function Header(props) {
    const handleOpenFullPage = async () => {
        await openOrFocusFullPageInCurrentWindow();
        window.close();
    };

    return (
        <header className="header header-popup">
            <div className="header-left">
                <LoginSection logout={props.logout} />
            </div>
            <div className="header-right">
                <TabSwitcherButton />
                <button
                    className="header-action-btn"
                    onClick={handleOpenFullPage}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Open in full page"
                >
                    <MdOpenInNew size={18} />
                </button>
                <Suspense fallback={<div className="settings-loading">&#9881;</div>}>
                    <SettingsMenu
                        updateRemoteData={props.updateRemoteData}
                        applyDataFromServer={props.applyDataFromServer} />
                </Suspense>
            </div>
        </header>
    );
}

export default Header;
export { LoginSection, SyncStatus };
