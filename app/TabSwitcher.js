import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useAtom, useAtomValue } from 'jotai';
import { tabSwitcherOpenState } from './atoms/tabSwitcherState';
import { viewContextState } from './atoms/globalAppSettingsState';
import { highlightText } from './utils/searchUtils';
import {
    loadTabEntries,
    filterTabEntries,
    initialSelectionIndex,
    RESULT_CAP,
} from './utils/tabSwitcherUtils';
import { FALLBACK_FAVICON } from './utils/sharedConstants';
import useListNavigation from './useListNavigation';
import ContextMenu from './ContextMenu';
import { copyToClipboard } from './utils/index';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { browser } from '../static/globals';
import {
    MdSearch,
    MdKeyboardReturn,
    MdTab,
    MdContentCopy,
    MdPushPin,
    MdVolumeOff,
    MdOpenInNew,
    MdClose,
    MdVisibilityOff,
} from 'react-icons/md';
import './TabSwitcher.css';

// Memoized with stable callback props so an arrow press re-renders only the
// two rows whose selection changed, not all 50 (each row also mounts a
// ContextMenu, which makes full-list re-renders measurably sluggish).
const TabSwitcherRow = React.memo(function TabSwitcherRow({ entry, index, isSelected, onHoverIndex, onActivateEntry, buildMenuItems, itemRefs, query }) {
    const rowRef = useRef(null);
    const menuItems = buildMenuItems(entry);

    return (
        <div
            ref={(el) => { rowRef.current = el; itemRefs.current[index] = el; }}
            className={`tab-switcher-row${isSelected ? ' selected' : ''}`}
            data-testid="tab-switcher-row"
            data-tab-id={entry.tabId}
            onClick={() => onActivateEntry(entry)}
            onMouseEnter={() => onHoverIndex(index)}
        >
            <img
                className="tab-switcher-favicon"
                src={entry.favIconUrl || FALLBACK_FAVICON}
                onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
                alt=""
            />
            <div className="tab-switcher-row-text">
                <span className="tab-switcher-row-title">
                    {highlightText(entry.title, query, 'tab-switcher-match') || entry.title}
                </span>
                <span className="tab-switcher-row-url">
                    {highlightText(entry.url, query, 'tab-switcher-match') || entry.url}
                </span>
            </div>
            <span className="tab-switcher-window-badge">
                {entry.incognito && (
                    <span className="tab-switcher-incognito-badge">
                        <MdVisibilityOff size={11} /> Incognito
                    </span>
                )}
                {entry.windowLabel}
            </span>
            <ContextMenu menuItems={menuItems} tooltip="Tab options" triggerRef={rowRef} />
            {isSelected && <MdKeyboardReturn size={14} className="tab-switcher-enter-hint" />}
        </div>
    );
});

// Details card for the selected tab. Pure render from the already-loaded
// entry — screenshot thumbnails were removed (captureVisibleTab can't see
// background tabs, so coverage was too sparse to be worth the optional
// <all_urls> permission).
function TabPreviewPane({ entry }) {
    if (!entry) return <div className="tab-switcher-preview empty" />;

    return (
        <div className="tab-switcher-preview">
            <div className="tab-switcher-preview-card">
                <img
                    className="tab-switcher-preview-favicon"
                    src={entry.favIconUrl || FALLBACK_FAVICON}
                    onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
                    alt=""
                />
                <div className="tab-switcher-preview-title">{entry.title}</div>
                <div className="tab-switcher-preview-url">{entry.url}</div>
            </div>
            <div className="tab-switcher-preview-meta">
                {entry.windowLabel}{entry.incognito ? ' · Incognito' : ''}
            </div>
        </div>
    );
}

function TabSwitcher() {
    const [isOpen, setIsOpen] = useAtom(tabSwitcherOpenState);
    const viewContext = useAtomValue(viewContextState);
    const [query, setQuery] = useState('');
    const [entries, setEntries] = useState([]);
    const inputRef = useRef(null);
    const itemRefs = useRef({});
    const didInitialSelectRef = useRef(false);

    const results = useMemo(() => filterTabEntries(entries, query), [entries, query]);
    const visibleResults = useMemo(() => results.slice(0, RESULT_CAP), [results]);
    const hiddenCount = results.length - visibleResults.length;

    const close = useCallback(() => setIsOpen(false), [setIsOpen]);

    const refreshEntries = useCallback(async () => {
        try {
            setEntries(await loadTabEntries());
        } catch {
            setEntries([]);
        }
        // Context-menu items are portaled to <body>, so clicking one moves DOM
        // focus off the overlay and keyboard nav (bound to the overlay's
        // onKeyDown) goes dead. Refocus the search input to restore it.
        inputRef.current?.focus();
    }, []);

    // Synchronous on purpose: every row is already mounted (refs populated), so
    // deferring to rAF only added a frame of lag to keyboard movement.
    const scrollSelectedIntoView = useCallback((index) => {
        itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
    }, []);

    const activateTab = useCallback(async (entry) => {
        if (!entry) return;
        try {
            await browser.tabs.update(entry.tabId, { active: true });
            if (!entry.isCurrentWindow) {
                await browser.windows.update(entry.windowId, { focused: true });
            }
            close();
            // Activating the already-active tab of the current window should
            // only close the switcher, not the whole popup.
            if (viewContext === 'popup' && !(entry.active && entry.isCurrentWindow)) window.close();
        } catch {
            // The tab vanished while the switcher was open — drop the stale row.
            showErrorToast('That tab is no longer open');
            refreshEntries();
        }
    }, [close, viewContext, refreshEntries]);

    const { selectedIndex, setSelectedIndex, handleKeyDown } = useListNavigation({
        count: visibleResults.length,
        onSelect: (i) => activateTab(visibleResults[i]),
        onClose: close,
        scrollTo: scrollSelectedIntoView,
        resetKey: query,
    });

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        didInitialSelectRef.current = false;
        refreshEntries();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => inputRef.current?.focus());
        });
    }, [isOpen, refreshEntries]);

    // Once entries first land for an empty query, preselect the "previous" tab.
    // Runs only once per open — later refreshEntries() calls (pin/mute/close
    // actions) must not yank the user's arrowed-to selection back to the top.
    useEffect(() => {
        if (!isOpen || query !== '' || didInitialSelectRef.current) return;
        if (entries.length === 0) return;
        setSelectedIndex(initialSelectionIndex(entries));
        didInitialSelectRef.current = true;
    }, [isOpen, entries, query, setSelectedIndex]);

    const buildMenuItems = useCallback((entry) => [
        { id: 'switch', text: 'Switch to tab', icon: <MdTab />, action: () => activateTab(entry) },
        {
            id: 'copy-url', text: 'Copy URL', icon: <MdContentCopy />,
            action: async () => {
                try {
                    await copyToClipboard(entry.url);
                    showSuccessToast('URL copied');
                } catch {
                    showErrorToast('Failed to copy URL');
                }
                // Copy URL doesn't refresh the list, so restore keyboard nav
                // here too (the portaled menu click moved focus to <body>).
                inputRef.current?.focus();
            },
        },
        {
            id: 'pin', text: entry.pinned ? 'Unpin tab' : 'Pin tab', icon: <MdPushPin />,
            action: async () => {
                try { await browser.tabs.update(entry.tabId, { pinned: !entry.pinned }); } catch { /* noop */ }
                refreshEntries();
            },
        },
        {
            id: 'mute', text: entry.muted ? 'Unmute tab' : 'Mute tab', icon: <MdVolumeOff />,
            action: async () => {
                try { await browser.tabs.update(entry.tabId, { muted: !entry.muted }); } catch { /* noop */ }
                refreshEntries();
            },
        },
        {
            id: 'move-new-window', text: 'Move to new window', icon: <MdOpenInNew />,
            action: async () => {
                try { await browser.windows.create({ tabId: entry.tabId }); } catch { /* noop */ }
                refreshEntries();
            },
        },
        {
            id: 'close', text: 'Close tab', icon: <MdClose />, className: 'danger',
            action: async () => {
                try { await browser.tabs.remove(entry.tabId); } catch { /* noop */ }
                refreshEntries();
            },
        },
    ], [activateTab, refreshEntries]);

    const handleOverlayClick = useCallback((e) => {
        if (e.target === e.currentTarget) close();
    }, [close]);

    if (!isOpen) return null;

    const selectedEntry = visibleResults[selectedIndex] || null;

    return ReactDOM.createPortal(
        <div className="tab-switcher-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} tabIndex={-1}>
            <div className={`tab-switcher-card ${viewContext === 'fullpage' ? 'fullpage' : 'popup'}`}>
                <div className="tab-switcher-main">
                    <div className="tab-switcher-input-row">
                        <MdSearch size={20} className="tab-switcher-search-icon" />
                        <input
                            ref={inputRef}
                            type="text"
                            className="tab-switcher-input"
                            placeholder="Jump to an open tab..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <kbd className="tab-switcher-esc-hint">Esc</kbd>
                    </div>
                    <div className="tab-switcher-results">
                        {visibleResults.length > 0 ? (
                            visibleResults.map((entry, i) => (
                                <TabSwitcherRow
                                    key={entry.tabId}
                                    entry={entry}
                                    index={i}
                                    isSelected={i === selectedIndex}
                                    onHoverIndex={setSelectedIndex}
                                    onActivateEntry={activateTab}
                                    buildMenuItems={buildMenuItems}
                                    itemRefs={itemRefs}
                                    query={query}
                                />
                            ))
                        ) : (
                            <div className="tab-switcher-empty">No matching tabs</div>
                        )}
                        {hiddenCount > 0 && (
                            <div className="tab-switcher-more-hint">
                                {hiddenCount} more — keep typing to narrow down
                            </div>
                        )}
                    </div>
                    <div className="tab-switcher-footer">
                        <span className="tab-switcher-footer-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                        <span className="tab-switcher-footer-hint"><kbd>↵</kbd> switch</span>
                        <span className="tab-switcher-footer-hint"><kbd>esc</kbd> close</span>
                    </div>
                </div>
                <TabPreviewPane entry={selectedEntry} />
            </div>
        </div>,
        document.body
    );
}

export default TabSwitcher;
