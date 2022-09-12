import React, { useEffect, useState } from 'react'
import './SettingsMenu.css';
import Switch from './Switch';
import { themeState, isLoggedInState, listKeyState } from './atoms/globalAppSettingsState';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import {
    Menu,
    FocusableItem,
    MenuHeader,
    MenuItem,
    MenuDivider,
} from '@szhsin/react-menu';
import '@szhsin/react-menu/dist/index.css';
import "@szhsin/react-menu/dist/theme-dark.css";
import { browser } from '../static/globals';
import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { Modal } from './Modal';
import { downloadTextFile } from './utils';
import { RiFolderAddFill, RiEdit2Line, RiSettings5Fill } from 'react-icons/ri';
import { AiTwotoneExperiment } from 'react-icons/ai';
import { ImNewTab } from 'react-icons/im';
import { MdOutlineSyncAlt, MdSettingsBackupRestore } from 'react-icons/md';


export default function SettingsMenu(props) {
    const themeMode = useRecoilValue(themeState);
    const [backupVersion, setBackupVersion] = useState(null);
    const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
    const [openSnackbar, ] = useSnackbar({ style: SnackbarStyle.SUCCESS });
    const isLoggedIn = useRecoilValue(isLoggedInState);
    const setListKey = useSetRecoilState(listKeyState);

    useEffect(async () => {
        const { backup, chkEnableAutoUpdate } = await browser.storage.local.get(['backup', 'chkEnableAutoUpdate']);
        setAutoUpdateEnabled(chkEnableAutoUpdate || false);
        if (backup && backup.version) { 
            setBackupVersion(backup.version);
        }
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

    const handleExport = async () => {
        const { tabsArray } = await browser.storage.local.get('tabsArray');
        const options = { year: 'numeric', month: 'numeric', day: 'numeric' };
        const date = new Date().toLocaleString('en-US', options).replace(/\//g, '-');
        const filename = `tabox_collections_${date}`;
        downloadTextFile(JSON.stringify(tabsArray), filename);
        openSnackbar(`Exported all collections to file: ${filename}.txt`);
    }

    const handleAutoUpdate = async () => {
        setTimeout(async () => {
            setListKey(Date.now().toString());
            setAutoUpdateEnabled(!autoUpdateEnabled);
        }, 100);
    }

    const confirmLoadFromDrive = async (onClose) => {
        onClose();
        await props.applyDataFromServer(true);
    }

    const handleForceLoad = async () => {
        confirmAlert({
            customUI: ({ onClose }) => <Modal 
                title="Load from Google Drive?"
                message={
                    <span>
                        Are you sure you want to load collections from Google Drive?<br />
                        This will only work if the data in Google Drive is different from what you see here.<br /><br />
                        This action cannot be undone!
                    </span>}
                onClose={onClose} 
                onConfirm={() => confirmLoadFromDrive(onClose)}
                cancelLabel='Cancel'
                confirmLabel='Load' />
        });
    }

    return <div className="settings-wrapper">
        <Menu 
            menuButton={
                ({ open }) => <div className="settings-button">
                    <RiSettings5Fill color={open ? 'var(--primary-color)' : 'var(--text-color)'} size="24" />
            </div>}
            arrow
            theming={themeMode === 'dark' ? 'dark' : undefined}
            overflow="auto"
            position="anchor"
            className='settings-items-wrapper'
        >
            <MenuHeader><RiFolderAddFill /> When adding a collection</MenuHeader>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                <Switch 
                    id="chkIgnorePinned"
                    textOn={<span><strong>Do not include</strong> pinned tabs</span>}
                    textOff={<span><strong>Include</strong> pinned tabs</span>}
                />
                )}
            </FocusableItem>
            <MenuDivider />
            <MenuHeader><ImNewTab /> When opening collections</MenuHeader>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                <Switch 
                    id="chkIgnoreDuplicates"
                    textOn={<span>If a tab already exists, <strong>do not open it</strong></span>}
                    textOff={<span>If a tab already exists, <strong>open it anyway</strong></span>}
                />
                )}
            </FocusableItem>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                <Switch 
                    id="chkEnableTabDiscard"
                    data-tip="Tab discard will unload the tab, quickly reloading it when focused.<br>This can help improve performance when opening a lot of tabs."
                    textOn={<span>Discard tabs on open: <strong>Enabled</strong></span>}
                    textOff={<span>Discard tabs on open: <strong>Disabled</strong></span>}
                />
                )}
            </FocusableItem>
            <MenuDivider />
            <MenuHeader><RiEdit2Line /> When editing collections</MenuHeader>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                <Switch 
                    id="chkColEditIgnoreDuplicateTabs"
                    data-tip="A tab is considered 'duplicate' <br />if it has the exact same URL as another tab"
                    textOn={<span>If a tab exists in the collection, <strong>do not add it</strong></span>}
                    textOff={<span>If a tab exists in the collection, <strong>add it anyway</strong></span>}
                />
                )}
            </FocusableItem>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                <Switch 
                    id="chkColEditIgnoreDuplicateGroups"
                    data-tip="A group is considered 'duplicate' <br />if it has the exact same name and color as another group"
                    textOn={<span>If a group already exists, <strong>append tabs to it</strong></span>}
                    textOff={<span>If a group already exists, <strong>add as a new group</strong></span>}
                />
                )}
            </FocusableItem>
            <MenuDivider />
            <MenuHeader><MdOutlineSyncAlt /> Auto update collections</MenuHeader>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                    <>
                    <Switch 
                        id="chkEnableAutoUpdate"
                        onMouseUp={handleAutoUpdate}
                        data-multiline={true}
                        data-tip="When opening a collection, track changes<br />to the window and update the collection in the background."
                        textOn={<span>Auto updating collections: <strong>Enabled</strong><sup>BETA</sup></span>}
                        textOff={<span>Auto updating collections: <strong>Disabled</strong><sup>BETA</sup></span>}
                    />&nbsp;
                    <AiTwotoneExperiment 
                        size="16" 
                        data-multiline={true} 
                        data-tip="WARNING!<br />This feature is experimental and may cause unexpected issues." />
                    </>
                )}
            </FocusableItem>
            <FocusableItem styles={{ width: '380px' }}>
                {() => (
                    <>
                    <Switch 
                        id="chkAutoUpdateOnNewCollection"
                        data-multiline={true}
                        disabled={!autoUpdateEnabled}
                        data-tip="When adding a new collection, start auto updating<br /> it with changes in the current window."
                        textOn={<span>Auto update new collections: <strong>Enabled</strong><sup>BETA</sup></span>}
                        textOff={<span>Auto update new collections: <strong>Disabled</strong><sup>BETA</sup></span>}
                    />&nbsp;
                    <AiTwotoneExperiment 
                        size="16" 
                        data-multiline={true} 
                        data-tip="WARNING!<br />This feature is experimental and may cause unexpected issues." />
                    </>
                )}
            </FocusableItem>
            <MenuDivider />
            <MenuHeader><MdSettingsBackupRestore /> Backup &amp; Restore</MenuHeader>
            <MenuItem onClick={handleExport}>Export all collections</MenuItem>
            { isLoggedIn && <MenuItem onClick={handleForceLoad}>Load collections from Google Drive backup</MenuItem> }
            { generateBackupMenuItem() }
        </Menu>
    </div>
}