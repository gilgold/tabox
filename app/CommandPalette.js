import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useAtom, useAtomValue } from 'jotai';
import { commandPaletteOpenState } from './atoms/commandPaletteState';
import { themeState, viewContextState } from './atoms/globalAppSettingsState';
import { isProState } from './atoms/premiumState';
import { sharedPanelOpenState } from './atoms/sharedFoldersState';
import { sidebarNavigationState } from './atoms/fullpageState';
import { isSharedFolder } from './utils/sharedFolderUtils';
import { getColorValue } from './utils/colorMigration';
import { escapeRegex, highlightText } from './utils/searchUtils';
import { copyToClipboard } from './utils/clipboardUtils';
import { browser } from '../static/globals';
import {
    MdSearch,
    MdLink,
    MdOpenInBrowser,
    MdDriveFileRenameOutline,
    MdDriveFileMoveOutline,
    MdDelete,
    MdContentCopy,
    MdCreateNewFolder,
    MdOpenInNew,
    MdFileDownload,
    MdFileUpload,
    MdHistory,
    MdKeyboardReturn,
    MdArrowBack,
    MdFolder,
    MdOutlineHome,
    MdWorkspacePremium,
    MdFolderShared,
    MdForum,
    MdOutlineTour,
} from 'react-icons/md';
import { CiExport } from 'react-icons/ci';
import { AI_TOOLS } from './ai/aiTasks';
import { SHOW_ONBOARDING_EVENT } from './OnboardingGuide';
import './CommandPalette.css';

export const EXTENSION_ACTIONS = [
    { id: 'create-folder', label: 'Create New Folder', keywords: 'folder new create add', icon: MdCreateNewFolder },
    { id: 'import', label: 'Import Collections', keywords: 'import file upload load', icon: MdFileUpload },
    { id: 'export-all', label: 'Export All Collections & Folders', keywords: 'export download backup save', icon: MdFileDownload },
    { id: 'open-fullpage', label: 'Open in Full Page', keywords: 'fullpage full page expand tab window big', icon: MdOpenInNew },
    { id: 'restore-session', label: 'Restore Recently Closed', fullpageLabel: 'Browse Recently Closed', keywords: 'restore recently closed recover previous history browse', icon: MdHistory },
    { id: 'manage-subscription', label: 'Manage Subscription', freeLabel: 'Upgrade to Pro', keywords: 'subscription manage billing plan cancel switch monthly annual yearly pro payment upgrade downgrade', icon: MdWorkspacePremium },
    { id: 'share-folder', label: 'Share Folder…', keywords: 'share folder collaborate invite team', icon: MdFolderShared, proOnly: true },
    // fullpageOnly: the Activity & comments panel is inherently view-bound to
    // the full-page layout — the sanctioned reason for a parity divergence.
    { id: 'open-shared-panel', label: 'Open Activity & Comments', keywords: 'activity comments shared folder discussion feed log panel', icon: MdForum, fullpageOnly: true },
    // requiresGoogleUser: only meaningful once signed in (the id comes from the
    // cached googleUser record) — also surfaced in Settings → Tabox Pro.
    { id: 'copy-google-id', label: 'Copy Google Account ID', keywords: 'google id account copy identifier pro support premium grant googleid', icon: MdContentCopy, requiresGoogleUser: true },
    { id: 'show-onboarding', label: 'Show Onboarding', keywords: 'onboarding welcome tour guide intro tutorial getting started replay help walkthrough', icon: MdOutlineTour },
];

const SETTINGS_TOGGLES = [
    { key: 'theme', label: 'Dark Mode', keywords: 'dark light mode theme appearance color', sideEffect: 'theme' },
    { key: 'chkShowBadge', label: 'Tab Counter Badge', keywords: 'badge icon count number tabs' },
    { key: 'chkPerformanceMode', label: 'Performance Mode', keywords: 'performance fast speed animation reduce battery cpu', sideEffect: 'performance' },
    { key: 'chkToolbarIconOpensFullPage', label: 'When Opening Tabox Launch In', keywords: 'toolbar extension icon action click launch open popup page tab new tab' },
    { key: 'chkIgnorePinned', label: 'Ignore Pinned Tabs When Adding', keywords: 'pinned tabs ignore exclude add save' },
    { key: 'chkIgnoreDuplicates', label: 'Skip Duplicate Tabs When Opening', keywords: 'duplicate tabs open skip ignore' },
    { key: 'chkEnableTabDiscard', label: 'Smart Tab Loading', keywords: 'smart tab loading discard lazy defer performance' },
    { key: 'chkColEditIgnoreDuplicateTabs', label: 'Skip Duplicate Tabs When Editing', keywords: 'duplicate tabs edit skip ignore' },
    { key: 'chkColEditIgnoreDuplicateGroups', label: 'Merge Duplicate Groups When Editing', keywords: 'duplicate groups merge edit append' },
    { key: 'chkEnableAutoUpdate', label: 'Auto Update Collections', keywords: 'auto update track collections sync' },
    { key: 'chkAutoUpdateOnNewCollection', label: 'Auto Update New Collections', keywords: 'auto update new collections track' },
    { key: 'chkManualUpdateLinkCollection', label: 'Update Button Links Collection', keywords: 'update link active window manual' },
];

// Extra search keywords per AI tool (the visible label comes from AI_TOOLS).
// All include "ai" so the whole group surfaces when the user types "ai".
const AI_ACTION_KEYWORDS = {
    'smart-organize': 'ai smart tab grouping organize group window loose tabs',
    'auto-rename': 'ai auto rename collections name suggest title',
    'auto-arrange-folders': 'ai auto arrange folders sort organize loose collections',
    'duplicate-sweep': 'ai duplicate tab sweep find dedupe remove clean',
    'split-collection': 'ai split collection break divide themed sub oversized',
};

// AI Tools modal actions, surfaced in the command palette (popup + full-page).
// Built from the canonical AI_TOOLS registry so labels/icons stay in sync.
const AI_ACTIONS = AI_TOOLS.map((tool) => ({
    id: `ai:${tool.id}`,
    toolId: tool.id,
    label: tool.title,
    keywords: AI_ACTION_KEYWORDS[tool.id] || 'ai',
    icon: tool.icon,
}));

const COLLECTION_SUB_ACTIONS = [
    { id: 'open', label: 'Open All Tabs', icon: MdOpenInBrowser },
    { id: 'rename', label: 'Rename', icon: MdDriveFileRenameOutline },
    { id: 'move', label: 'Move to Folder', icon: MdDriveFileMoveOutline },
    { id: 'duplicate', label: 'Duplicate', icon: MdContentCopy },
    { id: 'share-link', label: 'Share via Link', icon: MdLink },
    { id: 'export', label: 'Export', icon: CiExport },
    { id: 'delete', label: 'Delete', icon: MdDelete, danger: true },
];

function scoreMatch(text, query) {
    if (!text || !query) return 0;
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    if (lower === q) return 100;
    if (lower.startsWith(q)) return 80;
    if (lower.includes(q)) return 60;
    return 0;
}

function recentScore(c) {
    return Math.max(c.lastOpened || 0, c.lastUpdated || 0, c.createdOn || 0);
}

function CommandPalette({
    collections,
    folders,
    folderNameMap,
    onCreateFolder,
    onImport,
    onExportAll,
    onOpenFullPage,
    onRestoreSession,
    onCollectionAction,
    onOpenAiTool,
    onUpgradeToPro,
    onManageSubscription,
    onShareFolder,
}) {
    const [isOpen, setIsOpen] = useAtom(commandPaletteOpenState);
    const [, setThemeMode] = useAtom(themeState);
    const viewContext = useAtomValue(viewContextState);
    const isPro = useAtomValue(isProState);
    const isFullPage = viewContext === 'fullpage';
    const sidebarNavigation = useAtomValue(sidebarNavigationState);
    const [, setSharedPanelOpen] = useAtom(sharedPanelOpenState);
    // The Activity & comments action only applies when the full-page sidebar
    // selection is a shared folder.
    const selectedSharedFolder = useMemo(() => {
        if (!isFullPage) return null;
        const folder = (folders || []).find((f) => f.uid === sidebarNavigation) || null;
        return folder && isSharedFolder(folder) ? folder : null;
    }, [isFullPage, folders, sidebarNavigation]);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeCollection, setActiveCollection] = useState(null);

    // Inline rename mode
    const [renameMode, setRenameMode] = useState(false);
    const [renameValue, setRenameValue] = useState('');

    // Folder pick mode
    const [folderPickMode, setFolderPickMode] = useState(false);
    // 'move' (from a collection's sub-actions) or 'share' (top-level Share Folder… action)
    const [pickPurpose, setPickPurpose] = useState(null);

    // Settings toggle values (loaded from storage when palette opens)
    const [settingValues, setSettingValues] = useState({});
    // Signed-in Google account (gates the copy-google-id action)
    const [googleUser, setGoogleUser] = useState(null);

    const inputRef = useRef(null);
    const renameInputRef = useRef(null);
    const listRef = useRef(null);
    const itemRefs = useRef({});

    const resetState = useCallback(() => {
        setQuery('');
        setSelectedIndex(0);
        setActiveCollection(null);
        setRenameMode(false);
        setRenameValue('');
        setFolderPickMode(false);
        setPickPurpose(null);
    }, []);

    // Load all setting values from storage when palette opens
    const loadSettingValues = useCallback(async () => {
        const keys = SETTINGS_TOGGLES.map(s => s.key === 'theme' ? 'theme' : s.key);
        const data = await browser.storage.local.get([...keys, 'googleUser']);
        setGoogleUser(data.googleUser || null);
        const vals = {};
        SETTINGS_TOGGLES.forEach(s => {
            if (s.key === 'theme') {
                vals[s.key] = data.theme === 'dark';
            } else {
                vals[s.key] = !!data[s.key];
            }
        });
        setSettingValues(vals);
    }, []);

    useEffect(() => {
        if (isOpen) {
            resetState();
            loadSettingValues();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    inputRef.current?.focus();
                });
            });
        }
    }, [isOpen, resetState, loadSettingValues]);

    useEffect(() => {
        if (renameMode && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renameMode]);

    const close = useCallback(() => {
        setIsOpen(false);
    }, [setIsOpen]);

    const focusInput = useCallback(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                inputRef.current?.focus();
            });
        });
    }, []);

    const goBackToSubActions = useCallback(() => {
        setRenameMode(false);
        setRenameValue('');
        setFolderPickMode(false);
        setPickPurpose(null);
        setQuery('');
        setSelectedIndex(0);
        focusInput();
    }, [focusInput]);

    const goBackToRoot = useCallback(() => {
        setActiveCollection(null);
        setRenameMode(false);
        setRenameValue('');
        setFolderPickMode(false);
        setPickPurpose(null);
        setQuery('');
        setSelectedIndex(0);
        focusInput();
    }, [focusInput]);

    // --- Results computation ---

    const results = useMemo(() => {
        if (activeCollection) return [];
        const q = query.trim();
        const items = [];

        const allCollections = [...(collections || [])];
        if (q) {
            const regex = new RegExp(escapeRegex(q), 'i');
            allCollections
                .filter(c => c.name?.match(regex))
                .sort((a, b) => scoreMatch(b.name, q) - scoreMatch(a.name, q))
                .forEach(c => {
                    const folderName = c.parentId && folderNameMap ? folderNameMap[c.parentId] : null;
                    items.push({
                        type: 'collection',
                        id: c.uid,
                        label: c.name,
                        collection: c,
                        color: getColorValue(c.color),
                        hint: `${c.tabs?.length || 0} tabs${folderName ? ` · ${folderName}` : ''}`,
                    });
                });
        } else {
            allCollections
                .sort((a, b) => recentScore(b) - recentScore(a))
                .slice(0, 5)
                .forEach(c => {
                    const folderName = c.parentId && folderNameMap ? folderNameMap[c.parentId] : null;
                    items.push({
                        type: 'collection',
                        id: c.uid,
                        label: c.name,
                        collection: c,
                        color: getColorValue(c.color),
                        hint: `${c.tabs?.length || 0} tabs${folderName ? ` · ${folderName}` : ''}`,
                    });
                });
        }

        EXTENSION_ACTIONS.forEach(action => {
            if (isFullPage && action.id === 'open-fullpage') return;
            if (action.fullpageOnly && !isFullPage) return;
            if (action.id === 'open-shared-panel' && !selectedSharedFolder) return;
            if (action.proOnly && !isPro) return;
            if (action.requiresGoogleUser && !googleUser?.permissionId) return;
            const actionLabel = !isPro && action.freeLabel ? action.freeLabel : action.label;
            if (q) {
                const haystack = `${actionLabel} ${action.label} ${action.keywords}`.toLowerCase();
                if (!haystack.includes(q.toLowerCase())) return;
            }
            items.push({
                type: 'action',
                id: action.id,
                label: (isFullPage && action.fullpageLabel) ? action.fullpageLabel : actionLabel,
                icon: action.icon,
                actionDef: action,
            });
        });

        AI_ACTIONS.forEach(action => {
            if (q) {
                const haystack = `${action.label} ${action.keywords}`.toLowerCase();
                if (!haystack.includes(q.toLowerCase())) return;
            }
            items.push({
                type: 'ai-action',
                id: action.id,
                label: action.label,
                icon: action.icon,
                toolId: action.toolId,
            });
        });

        if (q) {
            SETTINGS_TOGGLES.forEach(setting => {
                const haystack = `${setting.label} ${setting.keywords}`.toLowerCase();
                if (!haystack.includes(q.toLowerCase())) return;
                items.push({
                    type: 'setting',
                    id: `setting:${setting.key}`,
                    label: setting.label,
                    settingKey: setting.key,
                    enabled: !!settingValues[setting.key],
                });
            });
        }

        return items;
    }, [query, collections, folderNameMap, activeCollection, isFullPage, settingValues, isPro, selectedSharedFolder, googleUser]);

    const subActions = useMemo(() => {
        if (!activeCollection || renameMode || folderPickMode) return [];
        const q = query.trim().toLowerCase();
        if (!q) return COLLECTION_SUB_ACTIONS;
        return COLLECTION_SUB_ACTIONS.filter(a =>
            a.label.toLowerCase().includes(q)
        );
    }, [activeCollection, query, renameMode, folderPickMode]);

    // Folder list for the move-to-folder / share-folder pickers
    const folderOptions = useMemo(() => {
        if (!folderPickMode) return [];
        if (pickPurpose === 'move' && !activeCollection) return [];
        const q = query.trim().toLowerCase();
        const opts = [];

        if (pickPurpose === 'move') {
            // "No folder (root)" option if collection is currently in a folder
            if (activeCollection.parentId) {
                const rootLabel = 'No Folder (Root)';
                if (!q || rootLabel.toLowerCase().includes(q)) {
                    opts.push({ id: '__root__', label: rootLabel, icon: MdOutlineHome, color: null });
                }
            }
        }

        (folders || []).forEach(f => {
            if (pickPurpose === 'move' && f.uid === activeCollection.parentId) return;
            // Sharing: only own/unshared folders can be (re)shared — never a folder you're merely a member of.
            if (pickPurpose === 'share' && f.shared && f.shared.role !== 'owner') return;
            if (q && !f.name.toLowerCase().includes(q)) return;
            opts.push({ id: f.uid, label: f.name, icon: MdFolder, color: getColorValue(f.color) });
        });
        return opts;
    }, [folderPickMode, pickPurpose, activeCollection, folders, query]);

    // What list is currently visible
    const displayItems = useMemo(() => {
        if (renameMode) return [];
        if (folderPickMode) return folderOptions;
        if (activeCollection) return subActions;
        return results;
    }, [renameMode, folderPickMode, folderOptions, activeCollection, subActions, results]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query, activeCollection, renameMode, folderPickMode]);

    const scrollSelectedIntoView = useCallback((index) => {
        const el = itemRefs.current[index];
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, []);

    // --- Action execution ---

    const executeAction = useCallback((actionId) => {
        if (actionId === 'share-folder') {
            setPickPurpose('share');
            setFolderPickMode(true);
            setQuery('');
            setSelectedIndex(0);
            focusInput();
            return;
        }
        close();
        switch (actionId) {
            case 'create-folder': onCreateFolder?.(); break;
            case 'import': onImport?.(); break;
            case 'export-all': onExportAll?.(); break;
            case 'open-fullpage': onOpenFullPage?.(); break;
            case 'restore-session': onRestoreSession?.(); break;
            case 'manage-subscription':
                if (isPro) onManageSubscription?.();
                else onUpgradeToPro?.();
                break;
            case 'open-shared-panel': setSharedPanelOpen(true); break;
            case 'copy-google-id':
                if (googleUser?.permissionId) copyToClipboard(googleUser.permissionId).catch(() => {});
                break;
            case 'show-onboarding':
                window.dispatchEvent(new CustomEvent(SHOW_ONBOARDING_EVENT));
                break;
        }
    }, [close, onCreateFolder, onImport, onExportAll, onOpenFullPage, onRestoreSession, onUpgradeToPro, onManageSubscription, focusInput, setSharedPanelOpen, googleUser, isPro]);

    const toggleSetting = useCallback(async (settingKey) => {
        const newVal = !settingValues[settingKey];
        setSettingValues(prev => ({ ...prev, [settingKey]: newVal }));

        const def = SETTINGS_TOGGLES.find(s => s.key === settingKey);

        if (settingKey === 'theme') {
            const newMode = newVal ? 'dark' : 'light';
            setThemeMode(newMode);
            document.documentElement.setAttribute('data-theme', newMode);
            await browser.storage.local.set({ theme: newMode, darkModeToggle: newVal });
        } else {
            await browser.storage.local.set({ [settingKey]: newVal });
        }

        if (def?.sideEffect === 'performance') {
            if (newVal) {
                document.documentElement.classList.add('performance-mode');
            } else {
                document.documentElement.classList.remove('performance-mode');
            }
        }

        if (settingKey === 'chkShowBadge') {
            try { await browser.runtime.sendMessage({ type: 'updateBadge' }); } catch { /* noop */ }
        }
    }, [settingValues, setThemeMode]);

    const handleSubAction = useCallback((subActionId) => {
        if (!activeCollection) return;

        if (subActionId === 'rename') {
            setRenameMode(true);
            setRenameValue(activeCollection.name);
            setQuery('');
            return;
        }

        if (subActionId === 'move') {
            setPickPurpose('move');
            setFolderPickMode(true);
            setQuery('');
            setSelectedIndex(0);
            focusInput();
            return;
        }

        close();
        onCollectionAction?.(activeCollection, subActionId);
    }, [activeCollection, close, onCollectionAction]);

    const handleRenameSubmit = useCallback(() => {
        const trimmed = renameValue.trim();
        if (!trimmed || !activeCollection) return;
        if (trimmed === activeCollection.name) {
            goBackToSubActions();
            return;
        }
        close();
        onCollectionAction?.(activeCollection, 'rename', { newName: trimmed });
    }, [renameValue, activeCollection, close, onCollectionAction, goBackToSubActions]);

    const handleFolderPick = useCallback((folderId) => {
        if (pickPurpose === 'share') {
            const folder = (folders || []).find(f => f.uid === folderId);
            close();
            if (folder) onShareFolder?.(folder);
            return;
        }
        if (!activeCollection) return;
        close();
        const targetId = folderId === '__root__' ? null : folderId;
        onCollectionAction?.(activeCollection, 'move', { targetFolderId: targetId });
    }, [pickPurpose, folders, activeCollection, close, onCollectionAction, onShareFolder]);

    const handleSelect = useCallback((index) => {
        if (folderPickMode) {
            const folder = folderOptions[index];
            if (folder) handleFolderPick(folder.id);
            return;
        }

        const item = displayItems[index];
        if (!item) return;

        if (activeCollection) {
            handleSubAction(item.id);
            return;
        }

        if (item.type === 'collection') {
            setActiveCollection(item.collection);
            setQuery('');
            setSelectedIndex(0);
        } else if (item.type === 'action') {
            executeAction(item.id);
        } else if (item.type === 'ai-action') {
            close();
            onOpenAiTool?.(item.toolId);
        } else if (item.type === 'setting') {
            toggleSetting(item.settingKey);
        }
    }, [displayItems, folderPickMode, folderOptions, activeCollection, executeAction, handleSubAction, handleFolderPick, toggleSetting, close, onOpenAiTool]);

    // --- Keyboard ---

    const handleKeyDown = useCallback((e) => {
        if (renameMode) {
            if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit(); }
            if (e.key === 'Escape') { e.preventDefault(); goBackToSubActions(); }
            return;
        }

        const count = displayItems.length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => {
                    const next = prev < count - 1 ? prev + 1 : 0;
                    requestAnimationFrame(() => scrollSelectedIntoView(next));
                    return next;
                });
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => {
                    const next = prev > 0 ? prev - 1 : count - 1;
                    requestAnimationFrame(() => scrollSelectedIntoView(next));
                    return next;
                });
                break;
            case 'Enter':
                e.preventDefault();
                handleSelect(selectedIndex);
                break;
            case 'Escape':
                e.preventDefault();
                if (folderPickMode) { goBackToSubActions(); }
                else if (activeCollection) { goBackToRoot(); }
                else { close(); }
                break;
            case 'Backspace':
                if (query === '') {
                    if (folderPickMode) goBackToSubActions();
                    else if (activeCollection) goBackToRoot();
                }
                break;
        }
    }, [renameMode, displayItems.length, selectedIndex, activeCollection, folderPickMode, query,
        close, handleSelect, handleRenameSubmit, goBackToSubActions, goBackToRoot, scrollSelectedIntoView]);

    const handleOverlayClick = useCallback((e) => {
        if (e.target === e.currentTarget) close();
    }, [close]);

    if (!isOpen) return null;

    const hasCollections = results.some(r => r.type === 'collection');
    const hasActions = results.some(r => r.type === 'action');
    const hasAiActions = results.some(r => r.type === 'ai-action');
    const actionsStart = results.findIndex(r => r.type === 'action');
    const aiActionsStart = results.findIndex(r => r.type === 'ai-action');
    const settingsStart = results.findIndex(r => r.type === 'setting');

    // Determine current input placeholder and scope label
    let placeholder = 'Search collections, actions, or settings...';
    let scopeLabel = null;
    if (renameMode) {
        scopeLabel = 'Rename';
        placeholder = '';
    } else if (folderPickMode) {
        scopeLabel = pickPurpose === 'share' ? 'Share Folder' : activeCollection?.name;
        placeholder = 'Pick a folder...';
    } else if (activeCollection) {
        scopeLabel = activeCollection.name;
        placeholder = 'Choose an action...';
    }

    const showBackBtn = (activeCollection || folderPickMode) && !renameMode;

    return ReactDOM.createPortal(
        <div className="cmd-palette-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} tabIndex={-1}>
            <div className="cmd-palette-card">
                <div className="cmd-palette-input-row">
                    {showBackBtn ? (
                        <button
                            className="cmd-palette-back-btn"
                            onClick={() => folderPickMode ? goBackToSubActions() : goBackToRoot()}
                            tabIndex={-1}
                        >
                            <MdArrowBack size={18} />
                        </button>
                    ) : (
                        !renameMode && <MdSearch className="cmd-palette-search-icon" size={20} />
                    )}
                    {scopeLabel && (
                        <span className="cmd-palette-scope-badge">
                            {activeCollection && !folderPickMode && (
                                <span
                                    className="cmd-palette-scope-dot"
                                    style={{ background: getColorValue(activeCollection.color) || 'var(--text-color)' }}
                                />
                            )}
                            {folderPickMode && (
                                pickPurpose === 'share'
                                    ? <MdFolderShared size={14} style={{ flexShrink: 0 }} />
                                    : <MdDriveFileMoveOutline size={14} style={{ flexShrink: 0 }} />
                            )}
                            {renameMode && <MdDriveFileRenameOutline size={14} style={{ flexShrink: 0 }} />}
                            {scopeLabel}
                        </span>
                    )}
                    {renameMode ? (
                        <input
                            ref={renameInputRef}
                            type="text"
                            className="cmd-palette-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            maxLength={50}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    ) : (
                        <input
                            ref={inputRef}
                            type="text"
                            className="cmd-palette-input"
                            placeholder={placeholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    )}
                    <kbd className="cmd-palette-esc-hint">Esc</kbd>
                </div>

                <div className="cmd-palette-results" ref={listRef}>
                    {renameMode ? (
                        <div className="cmd-palette-rename-hint">
                            Press <kbd>↵</kbd> to save &middot; <kbd>Esc</kbd> to cancel
                        </div>
                    ) : folderPickMode ? (
                        folderOptions.length > 0 ? (
                            folderOptions.map((opt, i) => {
                                const Icon = opt.icon;
                                return (
                                    <div
                                        key={opt.id}
                                        ref={el => itemRefs.current[i] = el}
                                        className={`cmd-palette-row${i === selectedIndex ? ' selected' : ''}`}
                                        onClick={() => handleSelect(i)}
                                        onMouseEnter={() => setSelectedIndex(i)}
                                    >
                                        {opt.color ? (
                                            <span className="cmd-palette-color-dot" style={{ background: opt.color }} />
                                        ) : (
                                            <Icon size={18} className="cmd-palette-row-icon" />
                                        )}
                                        <span className="cmd-palette-row-label">{opt.label}</span>
                                        {i === selectedIndex && <MdKeyboardReturn size={14} className="cmd-palette-enter-hint" />}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="cmd-palette-empty">
                                {(folders || []).length === 0 ? 'No folders yet' : 'No matching folders'}
                            </div>
                        )
                    ) : activeCollection ? (
                        subActions.length > 0 ? (
                            subActions.map((action, i) => {
                                const Icon = action.icon;
                                return (
                                    <div
                                        key={action.id}
                                        ref={el => itemRefs.current[i] = el}
                                        className={`cmd-palette-row${i === selectedIndex ? ' selected' : ''}${action.danger ? ' danger' : ''}`}
                                        onClick={() => handleSelect(i)}
                                        onMouseEnter={() => setSelectedIndex(i)}
                                    >
                                        <Icon size={18} className="cmd-palette-row-icon" />
                                        <span className="cmd-palette-row-label">{action.label}</span>
                                        {i === selectedIndex && <MdKeyboardReturn size={14} className="cmd-palette-enter-hint" />}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="cmd-palette-empty">No matching actions</div>
                        )
                    ) : (
                        displayItems.length > 0 ? (
                            <>
                                {hasCollections && (
                                    <div className="cmd-palette-section-label">
                                        {query ? 'Collections' : 'Recent Collections'}
                                    </div>
                                )}
                                {results.map((item, i) => {
                                    let header = null;
                                    if (item.type === 'action' && i === actionsStart) {
                                        header = (
                                            <>
                                                {hasCollections && <div className="cmd-palette-separator" />}
                                                <div className="cmd-palette-section-label">Actions</div>
                                            </>
                                        );
                                    } else if (item.type === 'ai-action' && i === aiActionsStart) {
                                        header = (
                                            <>
                                                {(hasCollections || hasActions) && <div className="cmd-palette-separator" />}
                                                <div className="cmd-palette-section-label">AI Tools</div>
                                            </>
                                        );
                                    } else if (item.type === 'setting' && i === settingsStart) {
                                        header = (
                                            <>
                                                {(hasCollections || hasActions || hasAiActions) && <div className="cmd-palette-separator" />}
                                                <div className="cmd-palette-section-label">Settings</div>
                                            </>
                                        );
                                    }
                                    return (
                                        <React.Fragment key={item.id}>
                                            {header}
                                            <ResultRow
                                                item={item} index={i} selectedIndex={selectedIndex}
                                                setSelectedIndex={setSelectedIndex} handleSelect={handleSelect}
                                                itemRefs={itemRefs} query={query}
                                            />
                                        </React.Fragment>
                                    );
                                })}
                            </>
                        ) : (
                            <div className="cmd-palette-empty">
                                {query ? 'No results found' : 'Start typing to search...'}
                            </div>
                        )
                    )}
                </div>

                <div className="cmd-palette-footer">
                    <span className="cmd-palette-footer-hint">
                        <kbd>↑</kbd><kbd>↓</kbd> navigate
                    </span>
                    <span className="cmd-palette-footer-hint">
                        <kbd>↵</kbd> {renameMode ? 'save' : 'select'}
                    </span>
                    <span className="cmd-palette-footer-hint">
                        <kbd>esc</kbd> {(activeCollection || renameMode || folderPickMode) ? 'back' : 'close'}
                    </span>
                </div>
            </div>
        </div>,
        document.body
    );
}

function ResultRow({ item, index, selectedIndex, setSelectedIndex, handleSelect, itemRefs, query }) {
    const isSelected = index === selectedIndex;
    const Icon = item.icon;

    return (
        <div
            ref={el => itemRefs.current[index] = el}
            className={`cmd-palette-row${isSelected ? ' selected' : ''}`}
            onClick={() => handleSelect(index)}
            onMouseEnter={() => setSelectedIndex(index)}
        >
            {item.type === 'collection' ? (
                <span
                    className="cmd-palette-color-dot"
                    style={{ background: item.color || 'var(--setting-row-border-color)' }}
                />
            ) : item.type === 'setting' ? (
                <span className={`cmd-palette-toggle-pill${item.enabled ? ' on' : ''}`}>
                    {item.enabled ? 'ON' : 'OFF'}
                </span>
            ) : (
                Icon && <Icon size={18} className="cmd-palette-row-icon" />
            )}
            <span className="cmd-palette-row-label">
                {item.type === 'collection' && query
                    ? (highlightText(item.label, query, 'cmd-palette-match') || item.label)
                    : item.label
                }
            </span>
            {item.hint && <span className="cmd-palette-row-hint">{item.hint}</span>}
            {item.type !== 'setting' && isSelected && <MdKeyboardReturn size={14} className="cmd-palette-enter-hint" />}
        </div>
    );
}

export default CommandPalette;
