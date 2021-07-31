import React, { useEffect, useState } from 'react'
import './SettingsMenu.css';
import Switch from './Switch';
import { themeState } from './atoms/globalAppSettingsState';
import { useRecoilValue } from 'recoil';
import {
    Menu,
    FocusableItem,
    MenuHeader,
    MenuItem,
    MenuDivider,
} from '@szhsin/react-menu';
import '@szhsin/react-menu/dist/index.css';
import "@szhsin/react-menu/dist/theme-dark.css";
import { browser } from '../static/index';
import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { Modal } from './Modal';


export default function SettingsMenu(props) {
    const themeMode = useRecoilValue(themeState);
    const [backupVersion, setBackupVersion] = useState(null);
    const [openSnackbar, closeSnackbar] = useSnackbar({style: SnackbarStyle.SUCCESS});

    useEffect(async () => {
        const { backup } = await browser.storage.local.get('backup');
        if (backup && backup.version) { 
            setBackupVersion(backup.version);
        };
    }, []);

    const confirmRestore = async (onClose) => {
        onClose();
        const { backup } = await browser.storage.local.get('backup');
        if (backup && backup.tabsArray) {
            await props.updateRemoteData(backup.tabsArray);
            openSnackbar(`Restored ${backup.tabsArray.length} collections from backup!`);
        }
    }

    const handleRestoreBackup = async () => {
        confirmAlert({
            customUI: ({ onClose }) => <Modal 
                title="Restore from backup?"
                message={<span>Are you sure you want to restore collections from backup?<br />This action cannot be undone!</span>}
                onClose={onClose} 
                onConfirm={() => confirmRestore(onClose)}
                cancelLabel='Cancel'
                confirmLabel='Restore' />
        });
    }

    const generateBackupMenuItem = () => {
        return backupVersion ? <MenuItem onClick={handleRestoreBackup}>
            Restore collections from version { backupVersion }
        </MenuItem> : null;
    }

    return <div className="settings-wrapper">
        <Menu 
            menuButton={
                ({ open }) => <div className="settings-button">
                <svg fill={open ? 'var(--primary-color)' : 'var(--text-color)'} xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 50 50" width="24px" height="24px">    <path d="M47.16,21.221l-5.91-0.966c-0.346-1.186-0.819-2.326-1.411-3.405l3.45-4.917c0.279-0.397,0.231-0.938-0.112-1.282 l-3.889-3.887c-0.347-0.346-0.893-0.391-1.291-0.104l-4.843,3.481c-1.089-0.602-2.239-1.08-3.432-1.427l-1.031-5.886 C28.607,2.35,28.192,2,27.706,2h-5.5c-0.49,0-0.908,0.355-0.987,0.839l-0.956,5.854c-1.2,0.345-2.352,0.818-3.437,1.412l-4.83-3.45 c-0.399-0.285-0.942-0.239-1.289,0.106L6.82,10.648c-0.343,0.343-0.391,0.883-0.112,1.28l3.399,4.863 c-0.605,1.095-1.087,2.254-1.438,3.46l-5.831,0.971c-0.482,0.08-0.836,0.498-0.836,0.986v5.5c0,0.485,0.348,0.9,0.825,0.985 l5.831,1.034c0.349,1.203,0.831,2.362,1.438,3.46l-3.441,4.813c-0.284,0.397-0.239,0.942,0.106,1.289l3.888,3.891 c0.343,0.343,0.884,0.391,1.281,0.112l4.87-3.411c1.093,0.601,2.248,1.078,3.445,1.424l0.976,5.861C21.3,47.647,21.717,48,22.206,48 h5.5c0.485,0,0.9-0.348,0.984-0.825l1.045-5.89c1.199-0.353,2.348-0.833,3.43-1.435l4.905,3.441 c0.398,0.281,0.938,0.232,1.282-0.111l3.888-3.891c0.346-0.347,0.391-0.894,0.104-1.292l-3.498-4.857 c0.593-1.08,1.064-2.222,1.407-3.408l5.918-1.039c0.479-0.084,0.827-0.5,0.827-0.985v-5.5C47.999,21.718,47.644,21.3,47.16,21.221z M25,32c-3.866,0-7-3.134-7-7c0-3.866,3.134-7,7-7s7,3.134,7,7C32,28.866,28.866,32,25,32z"/></svg>
            </div>}
            arrow
            theming={themeMode === 'dark' ? 'dark' : undefined}
            className='settings-items-wrapper'
        >
            <MenuHeader>When opening collections</MenuHeader>
            <FocusableItem styles={{width: '380px'}}>
                {({ ref }) => (
                <Switch 
                    id="chkIgnoreDuplicates"
                    textOn={<span>If a tab already exists, <strong>do not open it</strong></span>}
                    textOff={<span>If a tab already exists, <strong>open it anyway</strong></span>}
                />
                )}
            </FocusableItem>
            <MenuDivider />
            <MenuHeader>When editing collections</MenuHeader>
            <FocusableItem styles={{width: '380px'}}>
                {({ ref }) => (
                <Switch 
                    id="chkColEditIgnoreDuplicateTabs"
                    data-tip="A tab is considered 'duplicate' <br />if it has the exact same URL as another tab"
                    textOn={<span>If a tab exists in the collection, <strong>do not add it</strong></span>}
                    textOff={<span>If a tab exists in the collection, <strong>add it anyway</strong></span>}
                />
                )}
            </FocusableItem>
            <FocusableItem styles={{width: '380px'}}>
                {({ ref }) => (
                <Switch 
                    id="chkColEditIgnoreDuplicateGroups"
                    data-tip="A group is considered 'duplicate' <br />if it has the exact same name and color as another group"
                    textOn={<span>If a group already exists, <strong>do not add it</strong></span>}
                    textOff={<span>If a group already exists, <strong>add it anyway</strong></span>}
                />
                )}
            </FocusableItem>
            <MenuDivider />
            { generateBackupMenuItem() }
        </Menu>
    </div>
}