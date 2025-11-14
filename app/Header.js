import React, { useState, useEffect, lazy, Suspense } from 'react'
import './Header.css';
import { 
    isLoggedInState, 
} from './atoms/globalAppSettingsState';
import { useRecoilState } from 'recoil';
import { browser } from '../static/globals';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';

// Lazy load SettingsMenu to reduce initial bundle size
const SettingsMenu = lazy(() => import('./SettingsMenu'));

function LoginSection(props) {

    const [isLoggedIn, setIsLoggedIn] = useRecoilState(isLoggedInState);
    const [googleUser, setGoogleUser] = useState();
    const [openSnackbar, ] = useSnackbar({ style: SnackbarStyle.SUCCESS });

    useEffect(async () => {
        const { googleUser } = await browser.storage.local.get('googleUser');
        if (isLoggedIn && googleUser) {
            setGoogleUser(googleUser);
        }
    }, [isLoggedIn])
 
    const handleClick = async () => {
        if (isLoggedIn) {
            await props.logout();
            setGoogleUser(null);
            openSnackbar('Sync has been disabled', 3000)
        } else {
            browser.runtime.sendMessage({ type: 'login' }).then(async (response) => {
                if (response === false) return;
                setGoogleUser(response);
                setIsLoggedIn(true);
                openSnackbar('Sync is now enabled!', 3000);
            });
        }
    }

    return <div className="login-section" 
                     title={`Click here to ${isLoggedIn && googleUser ? 'disable' : 'enable'} Google Drive sync`} 
                     onClick={async () => await handleClick()}>
                <div className="avatar-wrapper">
                    <img id="avatar" 
                         className="avatar" 
                         src={ isLoggedIn && googleUser && googleUser.photoLink ? googleUser.photoLink : '/images/not_signed_in.png' } 
                         alt="user avatar" />
                </div>
                { isLoggedIn && googleUser ? (
                    <div className="user-info">
                        <div className="header_text">
                            Sync enabled for {googleUser.displayName}
                        </div>
                        <div className="email">
                            {googleUser.emailAddress}
                        </div>
                    </div>
                ) : <span className="header_text">Signin with Google to enable sync</span> }
            </div>;
}

function Header(props) {
  return <header className="header">
            <div className="header-left">
                <LoginSection logout={props.logout} />
            </div>
            <div className="header-right">
                <Suspense fallback={<div className="settings-loading">⚙️</div>}>
                    <SettingsMenu 
                        updateRemoteData={props.updateRemoteData} 
                        applyDataFromServer={props.applyDataFromServer} />
                </Suspense>
            </div>
        </header>;
}

export default Header;