import React, { useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { searchState } from '../atoms/globalAppSettingsState';
import { sidebarNavigationState } from '../atoms/fullpageState';
import { LoginSection, SyncStatus } from '../Header';
import TabSwitcherButton from '../TabSwitcherButton';
import { browser } from '../../static/globals';
import { MdSearch } from 'react-icons/md';
import './FPTopBar.css';

const SettingsMenu = lazy(() => import('../SettingsMenu'));

function FPTopBar({ logout, applyDataFromServer, updateRemoteData, onDataUpdate, triggerSync }) {
    const [search, setSearch] = useAtom(searchState);
    const sidebarNavigation = useAtomValue(sidebarNavigationState);
    const inputRef = useRef(null);
    const searchPlaceholder = useMemo(() => {
        switch (sidebarNavigation) {
            case 'current-windows':
                return 'Search for tabs within your current windows';
            case 'sessions':
                return 'Search recently closed browser items';
            case 'unorganized':
                return 'Search within collections with no folder';
            case 'all':
                return 'Search collections, tabs, and URLs';
            default:
                return 'Search within this folder';
        }
    }, [sidebarNavigation]);

    const handleSearchChange = (e) => {
        const val = e.target.value;
        setSearch(val.trim() !== '' ? val : null);
    };

    const handleClear = () => {
        setSearch(null);
        inputRef.current?.focus();
    };

    useEffect(() => {
        const handleSlashKey = (e) => {
            if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const tag = document.activeElement?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleSlashKey);
        return () => document.removeEventListener('keydown', handleSlashKey);
    }, []);

    const version = browser.runtime.getManifest().version;
    const hasValue = !!search?.trim();

    return (
        <div className="fp-topbar">
            {/* Left — Brand */}
            <div className="fp-topbar-left">
                <span className="fp-topbar-logo">Tabox</span>
                <span className="fp-topbar-version">v{version}</span>
            </div>

            {/* Center — Search */}
            <div className={`fp-search-bar${hasValue ? ' fp-search-bar-active' : ''}`}>
                <MdSearch className="fp-search-icon" size={19} />
                <input
                    ref={inputRef}
                    type="text"
                    className="fp-search-input"
                    placeholder={searchPlaceholder}
                    value={search || ''}
                    onChange={handleSearchChange}
                />
                {hasValue ? (
                    <button className="fp-search-clear" onClick={handleClear}>&times;</button>
                ) : (
                    <kbd className="fp-search-kbd">/</kbd>
                )}
            </div>

            {/* Right — Control Strip */}
            <div className="fp-topbar-right">
                <div className="fp-control-strip">
                    <TabSwitcherButton />
                    <div className="header-separator" />
                    <SyncStatus onTriggerSync={triggerSync} />
                    <div className="header-separator" />
                    <LoginSection logout={logout} compact />
                    <div className="header-separator" />
                    <Suspense fallback={<div className="fp-settings-loading">&#9881;</div>}>
                        <SettingsMenu
                            variant="fullpage"
                            updateRemoteData={updateRemoteData}
                            applyDataFromServer={applyDataFromServer}
                            onDataUpdate={onDataUpdate}
                        />
                    </Suspense>
                </div>
            </div>
        </div>
    );
}

export default FPTopBar;
