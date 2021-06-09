import React, {useState, useEffect} from 'react'
import './Header.css';
import { 
    isLoggedInState, 
} from './atoms/globalAppSettingsState';
import { useRecoilState } from 'recoil';
import { browser } from '../static/index';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';

function LoginSection(props) {

    const [isLoggedIn, setIsLoggedIn] = useRecoilState(isLoggedInState);
    const [googleUser, setGoogleUser] = useState();
    const [openSnackbar, closeSnackbar] = useSnackbar({style: SnackbarStyle.SUCCESS});

    useEffect(async () => {
        if (isLoggedIn) {
            const {googleUser} = await browser.storage.local.get('googleUser');
            setGoogleUser(googleUser);
        }
    }, [isLoggedIn])
 
    const handleClick = async (e) => {
        if (isLoggedIn) {
            await props.logout();
            openSnackbar('Sync has been disabled', 3000)
        } else {
            await browser.runtime.sendMessage({type: 'login'}).then(async (response) => {
                setGoogleUser(response);
                setIsLoggedIn(true);
                openSnackbar('Sync is now enabled!', 3000)
                await props.applyDataFromServer();
            })
        }
    }

    return <div className="user_image" title={`Click here to ${isLoggedIn && googleUser ? 'disable' : 'enable'} Google Drive sync`} onClick={handleClick}>
                <div className="row">
                    <div className="column">
                        <div className="row double-row">
                            <img id="avatar" className="avatar" src={ isLoggedIn && googleUser && googleUser.photoLink ? googleUser.photoLink : '/images/not_signed_in.png' } alt="user avatar" />
                        </div>
                    </div>
                    { isLoggedIn && googleUser ? (
                        <div className="column">
                            <div className="row header_text">
                                Sync enabled for {googleUser.displayName}
                            </div>
                            <div className="row email">
                                {googleUser.emailAddress}
                            </div>
                        </div>
                    ) : <span className="header_text">Signin with Google to enable sync</span> }
                </div>
            </div>;
}

function Header(props) {
  return <header className="header">
            <LoginSection applyDataFromServer={props.applyDataFromServer} logout={props.logout}/>
        </header>;
};

export default Header;