import React, { useEffect, useState, lazy, Suspense, useEffectEvent } from 'react'
import ReactDOM from 'react-dom'
import './SettingsMenu.css';
import Switch from './Switch';
import { themeState, isLoggedInState, listKeyState } from './atoms/globalAppSettingsState';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import { browser } from '../static/globals';
import Modal from 'react-modal';
import { showUndoToast } from './toastHelpers';
import { UNDO_TIME } from './constants';
import { downloadTextFile } from './utils';

// Lazy load SyncDebugModal as it's rarely used
const SyncDebugModal = lazy(() => import('./SyncDebugModal').then(module => ({ default: module.SyncDebugModal })));
import { RiFolderAddFill, RiEdit2Line, RiSettings5Fill } from 'react-icons/ri';
import { ImNewTab } from 'react-icons/im';
import { MdOutlineSyncAlt, MdSettingsBackupRestore, MdClose, MdExpandMore, MdExpandLess } from 'react-icons/md';
import {  MdBugReport } from 'react-icons/md';
import { FaRegCheckCircle } from 'react-icons/fa';
import { IoMoon, IoSunny } from 'react-icons/io5';

export default function SettingsMenu(props) {
    const [themeMode, setThemeMode] = useAtom(themeState);
    const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
    const [badgeEnabled, setBadgeEnabled] = useState(false);
    const [performanceModeEnabled, setPerformanceModeEnabled] = useState(false);
    const [isSyncDebugModalOpen, setIsSyncDebugModalOpen] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    
    // State for tracking which sections are expanded
    const [expandedSections, setExpandedSections] = useState({
        general: true,
        adding: true,
        opening: true,
        editing: true,
        autoUpdate: true,
        backup: true
    });
    
    const isLoggedIn = useAtomValue(isLoggedInState);
    const setListKey = useSetAtom(listKeyState);

    // Use Effect Event for initialization logic
    const onMount = useEffectEvent(async () => {
        const { chkEnableAutoUpdate, chkPerformanceMode } = await browser.storage.local.get(['chkEnableAutoUpdate', 'chkPerformanceMode']);
        setAutoUpdateEnabled(chkEnableAutoUpdate || false);
        setPerformanceModeEnabled(chkPerformanceMode || false);
        
        // Initialize dark mode switch state based on current theme
        const { theme } = await browser.storage.local.get('theme');
        const isDarkMode = theme === 'dark';
        await browser.storage.local.set({ darkModeToggle: isDarkMode });
        
        // Apply performance mode class to document if enabled
        if (chkPerformanceMode === true) {
            document.documentElement.classList.add('performance-mode');
        } else {
            document.documentElement.classList.remove('performance-mode');
        }
    });

    // Use Effect Event for badge updates
    const onBadgeChange = useEffectEvent(async () => {
        await browser.runtime.sendMessage({ type: 'updateBadge' });
    });

    useEffect(() => {
        onMount();
    }, []);

    useEffect(() => {
        onBadgeChange();
    }, [badgeEnabled]);

    // Dark mode toggle handler
    const handleDarkModeToggle = async () => {
        const newMode = themeMode === 'dark' ? 'light' : 'dark';
        const isDarkMode = newMode === 'dark';
        
        setThemeMode(newMode);
        document.documentElement.setAttribute('data-theme', newMode);
        await browser.storage.local.set({ 
            theme: newMode,
            darkModeToggle: isDarkMode 
        });
    };

    const showRecoverySuccess = (previousCollections) => {
        showUndoToast(
            <FaRegCheckCircle />,
            'Successfully recovered from backup',
            'Collections',
            async () => {
                // Undo recovery by restoring previous collections
                await props.updateRemoteData(previousCollections);
            },
            UNDO_TIME
        );
    };

    const handleSyncDebug = () => {
        setIsSyncDebugModalOpen(true);
        setIsDrawerOpen(false);
    };

    const closeSyncDebugModal = () => {
        setIsSyncDebugModalOpen(false);
    };

    const handleExport = async () => {
        setIsDrawerOpen(false);
        try {
            // Get all collections and folders
            const { loadAllCollections, loadAllFolders } = await import('./utils/storageUtils');
            const collections = await loadAllCollections();
            const folders = await loadAllFolders();

            // Create comprehensive export data
            const exportData = {
                type: 'full_export',
                collections: collections,
                folders: folders,
                exportedAt: new Date().toISOString(),
                version: '2.0',
                stats: {
                    totalCollections: collections.length,
                    totalFolders: folders.length,
                    collectionsInFolders: collections.filter(c => c.parentId).length,
                    rootCollections: collections.filter(c => !c.parentId).length
                }
            };

            const exported = JSON.stringify(exportData, null, 2);
            downloadTextFile(exported, `tabox-full-export-${Date.now()}`);
        } catch (error) {
            console.error('Error exporting all data:', error);
            // Fallback to old method
            const { settingsData } = await browser.storage.local.get('settingsData');
            const exported = JSON.stringify(settingsData, null, 2);
            downloadTextFile(exported, `tabox-export-${Date.now()}`);
        }
    };

    const handleAutoUpdate = async () => {
        setTimeout(async () => {
            setListKey(Date.now().toString());
            setAutoUpdateEnabled(!autoUpdateEnabled);
        }, 100);
    }

    const handleShowBadge = async () => {
        setTimeout(async () => {
            setBadgeEnabled(!badgeEnabled);
        }, 100);
    }

    const handlePerformanceMode = async () => {
        // Wait a bit for Switch component to update storage
        setTimeout(async () => {
            // Read the NEW value from storage (Switch component just updated it)
            const { chkPerformanceMode } = await browser.storage.local.get('chkPerformanceMode');
            const isEnabled = chkPerformanceMode === true;
            
            setPerformanceModeEnabled(isEnabled);
            
            // Apply/remove performance mode class to document
            if (isEnabled) {
                document.documentElement.classList.add('performance-mode');
            } else {
                document.documentElement.classList.remove('performance-mode');
            }
        }, 100);
    }

    const toggleDrawer = () => {
        setIsDrawerOpen(!isDrawerOpen);
    }

    // Toggle section expansion
    const toggleSection = (sectionKey) => {
        setExpandedSections(prev => ({
            ...prev,
            [sectionKey]: !prev[sectionKey]
        }));
    };

    return (
        <>
            <div className="settings-wrapper">
                <div className="settings-button" onClick={toggleDrawer}>
                    <RiSettings5Fill 
                        color={isDrawerOpen ? 'var(--primary-color)' : 'var(--text-color)'} 
                        size="24" 
                    />
                </div>
            </div>

            {ReactDOM.createPortal(
                <div className={`custom-drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={() => setIsDrawerOpen(false)}>
                    <div className={`custom-drawer ${isDrawerOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
                        <div className="settings-drawer-content">
                            {/* Header */}
                            <div className="settings-header">
                                <h2><RiSettings5Fill /> Settings</h2>
                                <button className="close-button" onClick={() => setIsDrawerOpen(false)}>
                                    <MdClose size="20" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="settings-content">
                                {/* General Settings */}
                                <div className="settings-section">
                                    <h3 className="settings-collapsible-header" onClick={() => toggleSection('general')}>
                                        <div className="header-content">
                                            <RiSettings5Fill /> 
                                            <span>General Settings</span>
                                        </div>
                                        {expandedSections.general ? <MdExpandLess /> : <MdExpandMore />}
                                    </h3>
                                    <div className={`collapsible-content ${expandedSections.general ? 'expanded' : 'collapsed'}`}>
                                        <div className="setting-item">
                                            <Switch 
                                                id="darkModeToggle"
                                                onMouseUp={handleDarkModeToggle}
                                                textOn={<span><IoMoon size="16" style={{ marginRight: '8px' }} />Dark Mode: <strong>On</strong></span>}
                                                textOff={<span><IoSunny size="16" style={{ marginRight: '8px' }} />Dark Mode: <strong>Off</strong></span>}
                                            />
                                        </div>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkShowBadge"
                                                onMouseUp={handleShowBadge}
                                                textOn={<span>Tab counter badge <strong>Enabled</strong></span>}
                                                textOff={<span>Tab counter badge <strong>Disabled</strong></span>}
                                            />
                                        </div>
                                        <div className="setting-item">
                                            <Switch
                                                id="chkPerformanceMode"
                                                onMouseUp={handlePerformanceMode}
                                                data-tooltip-id="main-tooltip" 
                                                data-tooltip-content="Reduces visual effects and animations to lower CPU usage and improve battery life"
                                                textOn={<span>⚡ Performance Mode: <strong>Enabled</strong></span>}
                                                textOff={<span>✨ Performance Mode: <strong>Disabled</strong></span>}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* When adding a collection */}
                                <div className="settings-section">
                                    <h3 className="settings-collapsible-header" onClick={() => toggleSection('adding')}>
                                        <div className="header-content">
                                            <RiFolderAddFill /> 
                                            <span>When adding a collection</span>
                                        </div>
                                        {expandedSections.adding ? <MdExpandLess /> : <MdExpandMore />}
                                    </h3>
                                    <div className={`collapsible-content ${expandedSections.adding ? 'expanded' : 'collapsed'}`}>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkIgnorePinned"
                                                textOn={<span><strong>Do not include</strong> pinned tabs</span>}
                                                textOff={<span><strong>Include</strong> pinned tabs</span>}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* When opening collections */}
                                <div className="settings-section">
                                    <h3 className="settings-collapsible-header" onClick={() => toggleSection('opening')}>
                                        <div className="header-content">
                                            <ImNewTab /> 
                                            <span>When opening collections</span>
                                        </div>
                                        {expandedSections.opening ? <MdExpandLess /> : <MdExpandMore />}
                                    </h3>
                                    <div className={`collapsible-content ${expandedSections.opening ? 'expanded' : 'collapsed'}`}>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkIgnoreDuplicates"
                                                textOn={<span>If a tab already exists, <strong>do not open it</strong></span>}
                                                textOff={<span>If a tab already exists, <strong>open it anyway</strong></span>}
                                            />
                                        </div>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkEnableTabDiscard"
                                                data-tooltip-id="main-tooltip" data-tooltip-content="Smart tab loading delays non-essential tabs to improve performance.<br>Automatically avoids deferring media, auth, development, and collaboration sites.<br>Tabs load instantly when you switch to them."
                                                textOn={<span>Smart tab loading: <strong>Enabled</strong></span>}
                                                textOff={<span>Smart tab loading: <strong>Disabled</strong></span>}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* When editing collections */}
                                <div className="settings-section">
                                    <h3 className="settings-collapsible-header" onClick={() => toggleSection('editing')}>
                                        <div className="header-content">
                                            <RiEdit2Line /> 
                                            <span>When editing collections</span>
                                        </div>
                                        {expandedSections.editing ? <MdExpandLess /> : <MdExpandMore />}
                                    </h3>
                                    <div className={`collapsible-content ${expandedSections.editing ? 'expanded' : 'collapsed'}`}>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkColEditIgnoreDuplicateTabs"
                                                data-tooltip-id="main-tooltip" data-tooltip-content="A tab is considered 'duplicate' <br />if it has the exact same URL as another tab"
                                                textOn={<span>If a tab exists in the collection, <strong>do not add it</strong></span>}
                                                textOff={<span>If a tab exists in the collection, <strong>add it anyway</strong></span>}
                                            />
                                        </div>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkColEditIgnoreDuplicateGroups"
                                                data-tooltip-id="main-tooltip" data-tooltip-content="A group is considered 'duplicate' <br />if it has the exact same name and color as another group"
                                                textOn={<span>If a group already exists, <strong>append tabs to it</strong></span>}
                                                textOff={<span>If a group already exists, <strong>add as a new group</strong></span>}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Auto update collections */}
                                <div className="settings-section">
                                    <h3 className="settings-collapsible-header" onClick={() => toggleSection('autoUpdate')}>
                                        <div className="header-content">
                                            <MdOutlineSyncAlt /> 
                                            <span>Auto update collections</span>
                                        </div>
                                        {expandedSections.autoUpdate ? <MdExpandLess /> : <MdExpandMore />}
                                    </h3>
                                    <div className={`collapsible-content ${expandedSections.autoUpdate ? 'expanded' : 'collapsed'}`}>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkEnableAutoUpdate"
                                                onMouseUp={handleAutoUpdate}
                                               
                                                data-tooltip-id="main-tooltip" data-tooltip-content="When opening a collection, track changes<br />to the window and update the collection in the background."
                                                textOn={<span>Auto updating collections: <strong>Enabled</strong></span>}
                                                textOff={<span>Auto updating collections: <strong>Disabled</strong></span>}
                                            />
                                        </div>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkAutoUpdateOnNewCollection"
                                               
                                                disabled={!autoUpdateEnabled}
                                                data-tooltip-id="main-tooltip" data-tooltip-content="When adding a new collection, start auto updating<br /> it with changes in the current window."
                                                textOn={<span>Auto update new collections: <strong>Enabled</strong></span>}
                                                textOff={<span>Auto update new collections: <strong>Disabled</strong></span>}
                                            />
                                        </div>
                                        <div className="setting-item">
                                            <Switch 
                                                id="chkManualUpdateLinkCollection"
                                               
                                                disabled={!autoUpdateEnabled}
                                                data-tooltip-id="main-tooltip" data-tooltip-content="When clicking the 'Update' button, this will link<br /> the collection to the window, making it 'active'."
                                                textOn={<span>Click on &#39;Update&#39; sets active: <strong>Enabled</strong></span>}
                                                textOff={<span>Click on &#39;Update&#39; sets active: <strong>Disabled</strong></span>}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Backup & Restore */}
                                <div className="settings-section">
                                    <h3 className="settings-collapsible-header" onClick={() => toggleSection('backup')}>
                                        <div className="header-content">
                                            <MdSettingsBackupRestore /> 
                                            <span>Backup & Restore</span>
                                        </div>
                                        {expandedSections.backup ? <MdExpandLess /> : <MdExpandMore />}
                                    </h3>
                                    <div className={`collapsible-content ${expandedSections.backup ? 'expanded' : 'collapsed'}`}>
                                        <button className="menu-button" onClick={handleExport}>
                                            Export all collections & folders
                                        </button>
                                        {isLoggedIn && (
                                            <button className="menu-button" onClick={handleSyncDebug}>
                                                <MdBugReport size="14" style={{ marginRight: '8px' }} />
                                                Sync Debug & Recovery
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>, document.body)}

            <Modal
                isOpen={isSyncDebugModalOpen}
                onRequestClose={closeSyncDebugModal}
                contentLabel="Sync Debug Modal"
                className="modal-content"
                overlayClassName="modal-overlay"
                ariaHideApp={false}
            >
                <Suspense fallback={<div style={{padding: '20px', textAlign: 'center'}}>Loading...</div>}>
                    <SyncDebugModal 
                        isOpen={isSyncDebugModalOpen}
                        onClose={closeSyncDebugModal}
                        applyDataFromServer={props.applyDataFromServer}
                        updateRemoteData={props.updateRemoteData}
                        onRecoverySuccess={showRecoverySuccess}
                    />
                </Suspense>
            </Modal>
        </>
    )
}