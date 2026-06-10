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
    FALLBACK_FAVICON,
} from './utils/tabSwitcherUtils';
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

const ALL_URLS = { origins: ['<all_urls>'] };

function TabSwitcherRow({ entry, index, isSelected, onHover, onActivate, menuItems, itemRefs, query }) {
    const rowRef = useRef(null);

    return (
        <div
            ref={(el) => { rowRef.current = el; itemRefs.current[index] = el; }}
            className={`tab-switcher-row${isSelected ? ' selected' : ''}`}
            data-testid="tab-switcher-row"
            data-tab-id={entry.tabId}
            onClick={onActivate}
            onMouseEnter={onHover}
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
}

function TabPreviewPane({ entry }) {
    const [hasPermission, setHasPermission] = useState(false);
    const [thumbnail, setThumbnail] = useState(null);
    const [debouncedEntry, setDebouncedEntry] = useState(entry);

    // Debounce selection changes so rapid arrowing never stutters the pane.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedEntry(entry), 150);
        return () => clearTimeout(t);
    }, [entry]);

    useEffect(() => {
        browser.permissions?.contains(ALL_URLS)
            .then((granted) => setHasPermission(!!granted))
            .catch(() => setHasPermission(false));
    }, []);

    useEffect(() => {
        let cancelled = false;
        setThumbnail(null);
        if (!hasPermission || !debouncedEntry) return undefined;
        // browser.storage.session requires Chrome 102+; treat as no thumbnail below that.
        if (!browser.storage.session) return undefined;
        const key = `thumb_${debouncedEntry.tabId}`;
        browser.storage.session.get(key)
            .then((data) => {
                if (!cancelled) setThumbnail(data?.[key]?.dataUrl || null);
            })
            .catch(() => { /* previews are best-effort */ });
        return () => { cancelled = true; };
    }, [debouncedEntry, hasPermission]);

    const requestPermission = useCallback(async () => {
        try {
            const granted = await browser.permissions.request(ALL_URLS);
            if (granted) {
                setHasPermission(true);
                browser.runtime.sendMessage({ type: 'captureAllWindows' }).catch(() => { /* noop */ });
            }
        } catch { /* dialog dismissed or no user gesture */ }
    }, []);

    if (!entry) return <div className="tab-switcher-preview empty" />;

    return (
        <div className="tab-switcher-preview">
            {thumbnail ? (
                <img className="tab-switcher-preview-shot" src={thumbnail} alt="Tab preview" />
            ) : (
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
            )}
            <div className="tab-switcher-preview-meta">
                {entry.windowLabel}{entry.incognito ? ' · Incognito' : ''}
            </div>
            {!hasPermission && (
                <button className="tab-switcher-enable-previews" onClick={requestPermission}>
                    Enable tab previews
                </button>
            )}
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
    }, []);

    const scrollSelectedIntoView = useCallback((index) => {
        requestAnimationFrame(() => {
            itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
        });
    }, []);

    const activateTab = useCallback(async (entry) => {
        if (!entry) return;
        try {
            await browser.tabs.update(entry.tabId, { active: true });
            if (!entry.isCurrentWindow) {
                await browser.windows.update(entry.windowId, { focused: true });
            }
            close();
            if (viewContext === 'popup') window.close();
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
                                    onHover={() => setSelectedIndex(i)}
                                    onActivate={() => activateTab(entry)}
                                    menuItems={buildMenuItems(entry)}
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
