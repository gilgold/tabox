import React, { useEffect, useState, useRef, lazy, Suspense, useEffectEvent } from 'react';
import ReactDOM from 'react-dom';
import Modal from 'react-modal';
import './SettingsMenu.css';
import Switch from './Switch';
import { ToastViewport } from './ToastViewport';
import { themeState, isLoggedInState, listKeyState } from './atoms/globalAppSettingsState';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import { browser } from '../static/globals';
import { showUndoToast, setToastViewContext } from './toastHelpers';
import { UNDO_TIME } from './constants';
import { downloadTextFile } from './utils';
import SyncDebugRecoveryPanel from './SyncDebugRecoveryPanel';
import { useOrphanRecoveryContext } from './OrphanRecoveryContext';
import { buildOrphanRecoveryMenuItem } from './orphanRecoveryMenuItem';
import { loadBrowserSessions, subscribeToBrowserSessions } from './utils/browserSessions';
import { RiFolderAddFill, RiEdit2Line, RiSettings5Fill } from 'react-icons/ri';
import { ImNewTab } from 'react-icons/im';
import { MdOutlineSyncAlt, MdSettingsBackupRestore, MdClose, MdExpandMore, MdExpandLess, MdBugReport, MdFileDownload, MdHistory } from 'react-icons/md';
import { FaRegCheckCircle } from 'react-icons/fa';
import { IoMoon, IoSunny } from 'react-icons/io5';
import { BsStars } from 'react-icons/bs';

const SyncDebugModal = lazy(() => import('./SyncDebugModal').then((module) => ({ default: module.SyncDebugModal })));
const AIEnableModal = lazy(() => import('./AIEnableModal'));
const SessionsModal = lazy(() => import('./SessionsModal').then(module => ({ default: module.SessionsModal })));

export default function SettingsMenu(props) {
    const { variant = 'popup' } = props;
    const isFullPageVariant = variant === 'fullpage';
    const [themeMode, setThemeMode] = useAtom(themeState);
    const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
    const [badgeEnabled, setBadgeEnabled] = useState(false);
    const [, setPerformanceModeEnabled] = useState(false);
    const [isSyncDebugModalOpen, setIsSyncDebugModalOpen] = useState(false);
    const [isAIEnableModalOpen, setIsAIEnableModalOpen] = useState(false);
    const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
    const [sessionList, setSessionList] = useState([]);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState('general');
    const isMountedRef = useRef(true);
    const [expandedSections, setExpandedSections] = useState({
        general: true,
        ai: true,
        adding: true,
        opening: true,
        editing: true,
        autoUpdate: true,
        backup: true,
    });

    const isLoggedIn = useAtomValue(isLoggedInState);
    const setListKey = useSetAtom(listKeyState);
    const orphanRecovery = useOrphanRecoveryContext() || {};

    const closeMenu = () => setIsDrawerOpen(false);

    const openMenu = () => {
        if (isFullPageVariant) {
            setActiveCategory('general');
        }
        setIsDrawerOpen(true);
    };

    const onMount = useEffectEvent(async () => {
        const { chkEnableAutoUpdate, chkPerformanceMode } = await browser.storage.local.get(['chkEnableAutoUpdate', 'chkPerformanceMode']);
        setAutoUpdateEnabled(chkEnableAutoUpdate || false);
        setPerformanceModeEnabled(chkPerformanceMode || false);

        const { theme } = await browser.storage.local.get('theme');
        const isDarkMode = theme === 'dark';
        await browser.storage.local.set({ darkModeToggle: isDarkMode });

        if (chkPerformanceMode === true) {
            document.documentElement.classList.add('performance-mode');
        } else {
            document.documentElement.classList.remove('performance-mode');
        }
    });

    const onBadgeChange = useEffectEvent(async () => {
        await browser.runtime.sendMessage({ type: 'updateBadge' });
    });

    useEffect(() => {
        onMount();

        const onStorageChanged = (changes) => {
            if (changes.chkEnableAutoUpdate && changes.chkEnableAutoUpdate.newValue !== undefined) {
                setAutoUpdateEnabled(!!changes.chkEnableAutoUpdate.newValue);
            }
            if (changes.chkPerformanceMode && changes.chkPerformanceMode.newValue !== undefined) {
                const enabled = !!changes.chkPerformanceMode.newValue;
                setPerformanceModeEnabled(enabled);
                if (enabled) {
                    document.documentElement.classList.add('performance-mode');
                } else {
                    document.documentElement.classList.remove('performance-mode');
                }
            }
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        return () => browser.storage.onChanged.removeListener(onStorageChanged);
    }, []);

    useEffect(() => {
        onBadgeChange();
    }, [badgeEnabled]);

    useEffect(() => {
        setToastViewContext(isFullPageVariant ? 'fullpage' : 'popup');
    }, [isFullPageVariant]);

    useEffect(() => {
        const loadSessions = async () => {
            const sessions = await loadBrowserSessions();
            if (isMountedRef.current) setSessionList(sessions);
        };

        loadSessions();

        const unsubscribe = subscribeToBrowserSessions(async () => {
            const sessions = await loadBrowserSessions();
            if (isMountedRef.current) setSessionList(sessions);
        });

        return () => {
            isMountedRef.current = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        const openSession = () => {
            if (isMountedRef.current && sessionList.length > 0) setIsSessionModalOpen(true);
        };
        window.addEventListener('tabox:open-restore-session', openSession);
        return () => window.removeEventListener('tabox:open-restore-session', openSession);
    }, [sessionList]);

    const handleDarkModeToggle = async () => {
        const newMode = themeMode === 'dark' ? 'light' : 'dark';
        const isDarkMode = newMode === 'dark';

        setThemeMode(newMode);
        document.documentElement.setAttribute('data-theme', newMode);
        await browser.storage.local.set({
            theme: newMode,
            darkModeToggle: isDarkMode,
        });
    };

    const showRecoverySuccess = (previousCollections) => {
        showUndoToast(
            <FaRegCheckCircle />,
            'Successfully recovered from backup',
            'Collections',
            async () => {
                await props.updateRemoteData(previousCollections);
            },
            UNDO_TIME,
        );
    };

    const handleSyncDebug = () => {
        setIsSyncDebugModalOpen(true);
        closeMenu();
    };

    const closeSyncDebugModal = () => {
        setIsSyncDebugModalOpen(false);
    };

    const handleExport = async () => {
        closeMenu();
        try {
            const { loadAllCollections, loadAllFolders } = await import('./utils/storageUtils');
            const collections = await loadAllCollections();
            const folders = await loadAllFolders();

            const exportData = {
                type: 'full_export',
                collections,
                folders,
                exportedAt: new Date().toISOString(),
                version: '2.0',
                stats: {
                    totalCollections: collections.length,
                    totalFolders: folders.length,
                    collectionsInFolders: collections.filter((collection) => collection.parentId).length,
                    rootCollections: collections.filter((collection) => !collection.parentId).length,
                },
            };

            const exported = JSON.stringify(exportData, null, 2);
            downloadTextFile(exported, `tabox-full-export-${Date.now()}`);
        } catch (error) {
            console.error('Error exporting all data:', error);
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
    };

    const handleShowBadge = async () => {
        setTimeout(async () => {
            setBadgeEnabled(!badgeEnabled);
        }, 100);
    };

    const handlePerformanceMode = async () => {
        setTimeout(async () => {
            const { chkPerformanceMode } = await browser.storage.local.get('chkPerformanceMode');
            const isEnabled = chkPerformanceMode === true;

            setPerformanceModeEnabled(isEnabled);

            if (isEnabled) {
                document.documentElement.classList.add('performance-mode');
            } else {
                document.documentElement.classList.remove('performance-mode');
            }
        }, 100);
    };

    const handleRestoreSession = () => {
        setIsSessionModalOpen(true);
        closeMenu();
    };

    const handleTaboxAIBeforeChange = (nextChecked) => {
        if (nextChecked) {
            // Enabling requires acknowledgment — only AIEnableModal's Enable
            // button writes chkTaboxAI: true. Veto the switch flip and open it.
            setIsAIEnableModalOpen(true);
            closeMenu();
            return false;
        }
        return true; // turning off needs no gate
    };

    const toggleDrawer = () => {
        if (isDrawerOpen) {
            closeMenu();
            return;
        }

        openMenu();
    };

    const toggleSection = (sectionKey) => {
        setExpandedSections((prev) => ({
            ...prev,
            [sectionKey]: !prev[sectionKey],
        }));
    };

    const commonSettingsSections = [
        {
            key: 'general',
            title: 'General Settings',
            icon: RiSettings5Fill,
            items: [
                {
                    type: 'switch',
                    key: 'darkModeToggle',
                    title: 'Dark Mode',
                    description: 'Switch Tabox between light and dark themes.',
                    switchProps: {
                        id: 'darkModeToggle',
                        onMouseUp: handleDarkModeToggle,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'Toggle between light and dark theme',
                        textOn: <span><IoMoon size="16" style={{ marginRight: '8px' }} />Dark Mode: <strong>On</strong></span>,
                        textOff: <span><IoSunny size="16" style={{ marginRight: '8px' }} />Dark Mode: <strong>Off</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkShowBadge',
                    title: 'Tab counter badge',
                    description: 'Show the total number of saved tabs on the toolbar icon.',
                    switchProps: {
                        id: 'chkShowBadge',
                        onMouseUp: handleShowBadge,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'Show the total number of tabs across all collections on the extension icon',
                        textOn: <span>Tab counter badge <strong>Enabled</strong></span>,
                        textOff: <span>Tab counter badge <strong>Disabled</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkPerformanceMode',
                    title: 'Performance Mode',
                    description: 'Reduce animations and visual effects to use less CPU and battery.',
                    switchProps: {
                        id: 'chkPerformanceMode',
                        onMouseUp: handlePerformanceMode,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'Reduces visual effects and animations to lower CPU usage and improve battery life',
                        textOn: <span>⚡ Performance Mode: <strong>Enabled</strong></span>,
                        textOff: <span>✨ Performance Mode: <strong>Disabled</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkToolbarIconOpensFullPage',
                    title: 'Toolbar launch mode',
                    description: 'Choose whether clicking the Tabox toolbar icon opens the popup or the full page.',
                    switchProps: {
                        id: 'chkToolbarIconOpensFullPage',
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'Choose what happens when you click the Tabox icon in the browser toolbar',
                        textOn: <span>When opening Tabox launch in: <strong>new tab</strong></span>,
                        textOff: <span>When opening Tabox launch in: <strong>popup</strong></span>,
                    },
                },
            ],
        },
        {
            key: 'ai',
            title: 'Tabox AI',
            icon: BsStars,
            description: 'On-device AI features powered by Chrome’s built-in model. Nothing leaves your computer.',
            items: [
                {
                    type: 'switch',
                    key: 'chkTaboxAI',
                    title: 'Tabox AI',
                    description: 'Enable on-device AI tools like auto-naming collections. Requires a one-time model download.',
                    switchProps: {
                        id: 'chkTaboxAI',
                        onBeforeChange: handleTaboxAIBeforeChange,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'AI runs locally in Chrome — your data never leaves your device',
                        textOn: <span><BsStars size="14" style={{ marginRight: '8px' }} />Tabox AI: <strong>Enabled</strong></span>,
                        textOff: <span><BsStars size="14" style={{ marginRight: '8px' }} />Tabox AI: <strong>Disabled</strong></span>,
                    },
                },
            ],
        },
        {
            key: 'adding',
            title: 'When adding a collection',
            icon: RiFolderAddFill,
            items: [
                {
                    type: 'switch',
                    key: 'chkIgnorePinned',
                    title: 'Pinned tabs',
                    description: 'Control whether pinned tabs are included when saving a new collection.',
                    switchProps: {
                        id: 'chkIgnorePinned',
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'Choose whether pinned tabs should be saved when creating a new collection',
                        textOn: <span><strong>Do not include</strong> pinned tabs</span>,
                        textOff: <span><strong>Include</strong> pinned tabs</span>,
                    },
                },
            ],
        },
        {
            key: 'opening',
            title: 'When opening collections',
            icon: ImNewTab,
            items: [
                {
                    type: 'switch',
                    key: 'chkIgnoreDuplicates',
                    title: 'Duplicate open tabs',
                    description: 'Skip tabs that are already open in the current window when restoring a collection.',
                    switchProps: {
                        id: 'chkIgnoreDuplicates',
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': 'Skip opening tabs that are already open in the current window',
                        textOn: <span>If a tab already exists, <strong>do not open it</strong></span>,
                        textOff: <span>If a tab already exists, <strong>open it anyway</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkEnableTabDiscard',
                    title: 'Smart tab loading',
                    description: 'Delay non-essential tabs until you activate them so large restores open more smoothly.',
                    switchProps: {
                        id: 'chkEnableTabDiscard',
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': "Smart tab loading delays non-essential tabs to improve performance.\nAutomatically avoids deferring media, auth, development, and collaboration sites.\nTabs load instantly when you switch to them.",
                        textOn: <span>Smart tab loading: <strong>Enabled</strong></span>,
                        textOff: <span>Smart tab loading: <strong>Disabled</strong></span>,
                    },
                },
            ],
        },
        {
            key: 'editing',
            title: 'When editing collections',
            icon: RiEdit2Line,
            items: [
                {
                    type: 'switch',
                    key: 'chkColEditIgnoreDuplicateTabs',
                    title: 'Duplicate tabs while editing',
                    description: 'Prevent adding the same URL twice to a collection.',
                    switchProps: {
                        id: 'chkColEditIgnoreDuplicateTabs',
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': "A tab is considered 'duplicate'\nif it has the exact same URL as another tab",
                        textOn: <span>If a tab exists in the collection, <strong>do not add it</strong></span>,
                        textOff: <span>If a tab exists in the collection, <strong>add it anyway</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkColEditIgnoreDuplicateGroups',
                    title: 'Duplicate groups while editing',
                    description: 'Append tabs to an existing matching group instead of creating another one.',
                    switchProps: {
                        id: 'chkColEditIgnoreDuplicateGroups',
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': "A group is considered 'duplicate'\nif it has the exact same name and color as another group",
                        textOn: <span>If a group already exists, <strong>append tabs to it</strong></span>,
                        textOff: <span>If a group already exists, <strong>add as a new group</strong></span>,
                    },
                },
            ],
        },
        {
            key: 'autoUpdate',
            title: 'Auto update collections',
            icon: MdOutlineSyncAlt,
            items: [
                {
                    type: 'switch',
                    key: 'chkEnableAutoUpdate',
                    title: 'Auto updating collections',
                    description: 'Keep tracked collections synced with changes in the linked browser window.',
                    switchProps: {
                        id: 'chkEnableAutoUpdate',
                        onMouseUp: handleAutoUpdate,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': "When opening a collection, track changes\nto the window and update the collection in the background.",
                        textOn: <span>Auto updating collections: <strong>Enabled</strong></span>,
                        textOff: <span>Auto updating collections: <strong>Disabled</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkAutoUpdateOnNewCollection',
                    title: 'Auto update new collections',
                    description: 'Automatically start tracking newly created collections when auto update is on.',
                    switchProps: {
                        id: 'chkAutoUpdateOnNewCollection',
                        disabled: !autoUpdateEnabled,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': "When adding a new collection, start auto updating\nit with changes in the current window.",
                        textOn: <span>Auto update new collections: <strong>Enabled</strong></span>,
                        textOff: <span>Auto update new collections: <strong>Disabled</strong></span>,
                    },
                },
                {
                    type: 'switch',
                    key: 'chkManualUpdateLinkCollection',
                    title: 'Update button sets active',
                    description: 'Link a collection to the current window when you manually click Update.',
                    switchProps: {
                        id: 'chkManualUpdateLinkCollection',
                        disabled: !autoUpdateEnabled,
                        'data-tooltip-id': 'main-tooltip',
                        'data-tooltip-content': "When clicking the 'Update' button, this will link\nthe collection to the window, making it 'active'.",
                        textOn: <span>Click on &#39;Update&#39; sets active: <strong>Enabled</strong></span>,
                        textOff: <span>Click on &#39;Update&#39; sets active: <strong>Disabled</strong></span>,
                    },
                },
            ],
        },
    ];

    const orphanRecoveryItem = buildOrphanRecoveryMenuItem(orphanRecovery, { onActivate: closeMenu });
    const popupBackupSection = {
        key: 'backup',
        title: 'Backup & Restore',
        icon: MdSettingsBackupRestore,
        items: [
            ...(orphanRecoveryItem ? [orphanRecoveryItem] : []),
            {
                type: 'button',
                key: 'restore-session',
                title: 'Restore recently closed',
                description: 'View and restore recently closed tabs and windows from your browser.',
                onClick: handleRestoreSession,
                isVisible: sessionList.length > 0,
                content: (
                    <>
                        <MdHistory size="14" style={{ marginRight: '8px' }} />
                        Restore recently closed
                    </>
                ),
            },
            {
                type: 'button',
                key: 'export-all',
                title: 'Export all collections & folders',
                description: 'Download a full backup of every collection and folder.',
                onClick: handleExport,
                content: 'Export all collections & folders',
            },
            {
                type: 'button',
                key: 'sync-debug',
                title: 'Sync Debug & Recovery',
                description: 'Open sync diagnostics and recovery tools for your Google Drive data.',
                onClick: handleSyncDebug,
                isVisible: isLoggedIn,
                content: (
                    <>
                        <MdBugReport size="14" style={{ marginRight: '8px' }} />
                        Sync Debug & Recovery
                    </>
                ),
            },
        ],
    };

    const fullPageSettingsSections = [
        ...commonSettingsSections,
        {
            key: 'export-all',
            title: 'Export All Collections',
            icon: MdFileDownload,
            description: 'Create a full portable export of every saved collection and folder in one file.',
            items: [
                {
                    type: 'button',
                    key: 'export-all',
                    title: 'Export all collections & folders',
                    description: 'Download a full backup of every collection and folder.',
                    onClick: handleExport,
                    content: 'Export all collections & folders',
                },
            ],
        },
        {
            key: 'recovery',
            title: 'Recovery',
            icon: MdSettingsBackupRestore,
            description: 'Restore a full backup or choose specific saved collections to recover.',
            items: [],
            renderFullPageContent: () => (
                <SyncDebugRecoveryPanel
                    isActive={isDrawerOpen && activeCategory === 'recovery'}
                    isSyncEnabled={isLoggedIn}
                    mode="recovery"
                    applyDataFromServer={props.applyDataFromServer}
                    updateRemoteData={props.updateRemoteData}
                    onDataUpdate={props.onDataUpdate}
                    feedbackToasterId={isFullPageVariant ? 'settings-modal' : undefined}
                />
            ),
        },
        {
            key: 'diagnostics',
            title: 'Diagnostics',
            icon: MdBugReport,
            description: 'Review sync logs, export diagnostics, and run Google Drive sync recovery actions.',
            items: [],
            renderFullPageContent: () => (
                <SyncDebugRecoveryPanel
                    isActive={isDrawerOpen && activeCategory === 'diagnostics'}
                    isSyncEnabled={isLoggedIn}
                    mode="diagnostics"
                    applyDataFromServer={props.applyDataFromServer}
                    updateRemoteData={props.updateRemoteData}
                    onDataUpdate={props.onDataUpdate}
                    feedbackToasterId={isFullPageVariant ? 'settings-modal' : undefined}
                />
            ),
        },
    ];

    const settingsSections = isFullPageVariant
        ? fullPageSettingsSections
        : [...commonSettingsSections, popupBackupSection];

    const visibleItemsForSection = (section) => section.items.filter((item) => item.isVisible !== false);
    const activeSection = settingsSections.find((section) => section.key === activeCategory) || settingsSections[0];
    const ActiveSectionIcon = activeSection.icon;

    const renderPopupItem = (item) => {
        if (item.type === 'button') {
            return (
                <button key={item.key} className="menu-button" onClick={item.onClick}>
                    {item.content}
                </button>
            );
        }

        return (
            <div key={item.key} className="setting-item">
                <Switch {...item.switchProps} />
            </div>
        );
    };

    const renderFullPageItem = (item) => {
        if (item.type === 'button') {
            return (
                <div key={item.key} className="fp-settings-item-card fp-settings-item-card-action">
                    <div className="fp-settings-item-copy">
                        <h4>{item.title}</h4>
                        <p>{item.description}</p>
                    </div>
                    <button className="menu-button fp-settings-menu-button" onClick={item.onClick}>
                        {item.content}
                    </button>
                </div>
            );
        }

        return (
            <div key={item.key} className="fp-settings-item-card">
                <div className="fp-settings-item-copy">
                    <h4>{item.title}</h4>
                    <p>{item.description}</p>
                </div>
                <div className="fp-settings-item-control">
                    <Switch {...item.switchProps} animateOnUserToggleOnly={true} />
                </div>
            </div>
        );
    };

    return (
        <>
            <div className="settings-wrapper">
                <div className="settings-button" onClick={toggleDrawer}>
                    <RiSettings5Fill
                        color={isDrawerOpen ? 'var(--primary-color)' : 'var(--text-color)'}
                        size="28"
                    />
                    {orphanRecovery.showEntry && (
                        <span
                            className="settings-orphan-dot"
                            aria-label={`${orphanRecovery.orphanCount} collections can be restored`}
                            title={`${orphanRecovery.orphanCount} collections can be restored`}
                        />
                    )}
                </div>
            </div>

            {!isFullPageVariant && ReactDOM.createPortal(
                <div className={`custom-drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={closeMenu}>
                    <div className={`custom-drawer ${isDrawerOpen ? 'open' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <div className="settings-drawer-content">
                            <div className="settings-header">
                                <h2><RiSettings5Fill /> Settings</h2>
                                <button className="close-button" onClick={closeMenu}>
                                    <MdClose size="20" />
                                </button>
                            </div>

                            <div className="settings-content">
                                {settingsSections.map((section) => {
                                    const SectionIcon = section.icon;
                                    const visibleItems = visibleItemsForSection(section);

                                    return (
                                        <div key={section.key} className="settings-section">
                                            <h3 className="settings-collapsible-header" onClick={() => toggleSection(section.key)}>
                                                <div className="header-content">
                                                    <SectionIcon />
                                                    <span>{section.title}</span>
                                                </div>
                                                {expandedSections[section.key] ? <MdExpandLess /> : <MdExpandMore />}
                                            </h3>
                                            <div className={`collapsible-content ${expandedSections[section.key] ? 'expanded' : 'collapsed'}`}>
                                                {visibleItems.map(renderPopupItem)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body,
            )}

            {isFullPageVariant && (
                <Modal
                    isOpen={isDrawerOpen}
                    onRequestClose={closeMenu}
                    contentLabel="Settings"
                    className="fp-settings-modal"
                    overlayClassName="fp-settings-modal-overlay"
                    ariaHideApp={false}
                    shouldCloseOnOverlayClick={true}
                    shouldCloseOnEsc={true}
                >
                    <div className="fp-settings-modal-shell">
                        <ToastViewport
                            context="fullpage"
                            toasterId="settings-modal"
                            disablePortal={true}
                        />
                        <aside className="fp-settings-sidebar" aria-label="Settings categories">
                            <div className="fp-settings-sidebar-header">
                                <h2><RiSettings5Fill /> Settings</h2>
                                <p>Customize how Tabox saves, opens, and restores your collections.</p>
                            </div>

                            <nav className="fp-settings-sidebar-nav">
                                {settingsSections.map((section) => {
                                    const SectionIcon = section.icon;
                                    const isActive = section.key === activeSection.key;

                                    return (
                                        <button
                                            key={section.key}
                                            type="button"
                                            className={`fp-settings-sidebar-item ${isActive ? 'active' : ''}`}
                                            onClick={() => setActiveCategory(section.key)}
                                        >
                                            <SectionIcon className="fp-settings-sidebar-item-icon" />
                                            <span>{section.title}</span>
                                            {section.key === 'recovery' && orphanRecovery.showEntry && (
                                                <span className="fp-settings-sidebar-badge">{orphanRecovery.orphanCount}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </nav>
                        </aside>

                        <div className="fp-settings-main">
                            <div className="fp-settings-main-header">
                                <div className="fp-settings-main-heading">
                                    <h3><ActiveSectionIcon /> {activeSection.title}</h3>
                                    <p>{activeSection.description || 'Review and update the settings in this category without changing their current behavior.'}</p>
                                </div>

                                <button className="close-button" onClick={closeMenu}>
                                    <MdClose size="20" />
                                </button>
                            </div>

                            <div className="fp-settings-main-content">
                                {typeof activeSection.renderFullPageContent === 'function'
                                    ? activeSection.renderFullPageContent()
                                    : visibleItemsForSection(activeSection).map(renderFullPageItem)}
                            </div>
                        </div>
                    </div>
                </Modal>
            )}

            {!isFullPageVariant && (
                <Modal
                    isOpen={isSyncDebugModalOpen}
                    onRequestClose={closeSyncDebugModal}
                    contentLabel="Sync Debug Modal"
                    className="modal-content"
                    overlayClassName="modal-overlay"
                    ariaHideApp={false}
                >
                    <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>}>
                        <SyncDebugModal
                            isOpen={isSyncDebugModalOpen}
                            onClose={closeSyncDebugModal}
                            applyDataFromServer={props.applyDataFromServer}
                            updateRemoteData={props.updateRemoteData}
                            onDataUpdate={props.onDataUpdate}
                            onRecoverySuccess={showRecoverySuccess}
                        />
                    </Suspense>
                </Modal>
            )}

            {isAIEnableModalOpen && (
                <Suspense fallback={null}>
                    <AIEnableModal
                        isOpen={isAIEnableModalOpen}
                        onClose={() => setIsAIEnableModalOpen(false)}
                    />
                </Suspense>
            )}

            {!isFullPageVariant && (
                <Modal
                    isOpen={isSessionModalOpen}
                    onRequestClose={() => setIsSessionModalOpen(false)}
                    contentLabel="Sessions Modal"
                    className="modal-content"
                    overlayClassName="modal-overlay"
                    ariaHideApp={false}
                >
                    <Suspense fallback={<div style={{padding: '20px', textAlign: 'center'}}>Loading...</div>}>
                        <SessionsModal
                            isOpen={isSessionModalOpen}
                            sessions={sessionList}
                            addCollection={props.addCollection}
                            onClose={() => setIsSessionModalOpen(false)}
                        />
                    </Suspense>
                </Modal>
            )}
        </>
    );
}
