import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdCenterFocusWeak, MdClose, MdExpandLess, MdExpandMore, MdOpenInBrowser, MdOutlineOpenInBrowser, MdSearch } from 'react-icons/md';
import { getColorCode } from '../utils';
import { highlightText } from '../utils/searchUtils';
import { browser } from '../../static/globals';
import { showErrorToast } from '../toastHelpers';
import { FALLBACK_FAVICON } from '../utils/sharedConstants';
import ClickableTabUrl from './ClickableTabUrl';
import FPBadge from './FPBadge';
import '../CollectionDetailPanel.css';
import './FPCurrentWindowPanel.css';

const formatUrlPreview = (url) => {
    if (!url) {
        return '';
    }
    return url.length > 96 ? `${url.slice(0, 95)}...` : url;
};

const buildVisibleItems = (windowSnapshot, search) => {
    const searchTerm = search?.trim()?.toLowerCase() || '';
    const visibleTabs = searchTerm
        ? (windowSnapshot.tabs || []).filter((tab) => (
            tab.title?.toLowerCase().includes(searchTerm) || tab.url?.toLowerCase().includes(searchTerm)
        ))
        : (windowSnapshot.tabs || []);
    const groupsByUid = new Map((windowSnapshot.chromeGroups || []).map((group) => [group.uid, group]));
    const emittedGroupUids = new Set();
    const items = [];

    visibleTabs.forEach((tab) => {
        if (tab.groupUid && groupsByUid.has(tab.groupUid)) {
            if (emittedGroupUids.has(tab.groupUid)) {
                return;
            }
            emittedGroupUids.add(tab.groupUid);
            items.push({
                type: 'group',
                group: groupsByUid.get(tab.groupUid),
                tabs: visibleTabs.filter((candidate) => candidate.groupUid === tab.groupUid),
            });
            return;
        }

        items.push({
            type: 'tab',
            tab,
        });
    });

    return {
        visibleTabs,
        items,
    };
};

function CurrentWindowTabRow({
    tab,
    groupColor = null,
    search,
    isClosing,
    isContextMenuActive,
    onTabAction,
    onContextMenu,
}) {
    const handleFocus = async (event) => {
        event.stopPropagation();
        await onTabAction(tab, 'focus');
    };

    const handleOpen = async (event) => {
        event.stopPropagation();
        await onTabAction(tab, 'open');
    };

    const handleClose = (event) => {
        event.stopPropagation();
        onTabAction(tab, 'close');
    };

    return (
        <div
            className="tab-line current-window-tab-line"
            id={`current-window-tab-line-${tab.uid}`}
            onContextMenu={(event) => onContextMenu(event, tab)}
        >
            <div className={`row single-tab-row current-window-tab-row ${tab.pinned ? 'pinned-tab' : ''} ${isContextMenuActive ? 'current-window-tab-row-context-active' : ''}`}>
                {groupColor ? (
                    <div
                        className="group-indicator"
                        style={{
                            backgroundColor: groupColor,
                            boxShadow: `${groupColor} -3px 1px 3px -2px`,
                        }}
                    />
                ) : (
                    <div className="group-placeholder" />
                )}

                <div className="column favicon-col">
                    <img
                        className="tab-favicon"
                        src={tab.favIconUrl || FALLBACK_FAVICON}
                        alt=""
                        onError={(event) => {
                            event.target.src = FALLBACK_FAVICON;
                        }}
                    />
                </div>
                <div className="column single-tab-title-col">
                    <div className="tab-title-wrapper">
                        <span className="single-tab-title" title={tab.title}>
                            {highlightText(tab.title, search, 'search-match-text') || tab.title}
                        </span>
                        <ClickableTabUrl
                            url={tab.url}
                            className="tab-url-preview"
                        >
                            {highlightText(formatUrlPreview(tab.url), search, 'search-match-text') || formatUrlPreview(tab.url)}
                        </ClickableTabUrl>
                    </div>
                </div>
                <div className="column actions-col">
                    <button
                        type="button"
                        className="tab-action-btn current-window-tab-hover-action current-window-tab-focus-btn"
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Focus this tab in its window"
                        onClick={handleFocus}
                    >
                        <MdCenterFocusWeak size={12} className="current-window-tab-icon current-window-tab-icon-focus" />
                        <span>Focus</span>
                    </button>
                    <button
                        type="button"
                        className="tab-action-btn current-window-tab-hover-action current-window-tab-open-btn"
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Open this tab in the current window"
                        onClick={handleOpen}
                        disabled={!tab.url}
                    >
                        <MdOutlineOpenInBrowser size={11} className="current-window-tab-icon current-window-tab-icon-open" />
                        <span>Open</span>
                    </button>
                    <button
                        type="button"
                        className="tab-action-btn current-window-tab-hover-action current-window-tab-close-btn"
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Close this tab"
                        onClick={handleClose}
                        disabled={isClosing}
                    >
                        <MdClose size={11} className="current-window-tab-icon current-window-tab-icon-close" />
                        <span>Close</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

function CurrentWindowGroup({
    group,
    tabs,
    search,
    isExpanded,
    onToggleExpanded,
    onTabAction,
    onTabContextMenu,
    activeContextTabUid,
    closingTabIds,
}) {
    const groupColor = getColorCode(group.color);

    return (
        <div className="current-window-group">
            <div className="group-wrapper">
                <div className="row group-header current-window-group-header">
                    <div
                        className="group-header-title current-window-group-title"
                        style={{ backgroundColor: `${groupColor}22`, color: groupColor }}
                    >
                        <span className="current-window-group-color" style={{ backgroundColor: groupColor }} />
                        <span>{group.title || 'Untitled Group'}</span>
                        <span className="current-window-group-count">{tabs.length}</span>
                    </div>
                    <div className="group-header-actions current-window-group-actions">
                        <button
                            type="button"
                            className="current-window-group-toggle"
                            onClick={() => onToggleExpanded(group.uid)}
                        >
                            {isExpanded ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
                        </button>
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="group-tabs-container current-window-group-tabs">
                    {tabs.map((tab) => (
                        <CurrentWindowTabRow
                            key={tab.uid}
                            tab={tab}
                            groupColor={groupColor}
                            search={search}
                            isClosing={closingTabIds.has(tab.id)}
                            isContextMenuActive={activeContextTabUid === tab.uid}
                            onTabAction={onTabAction}
                            onContextMenu={onTabContextMenu}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FPCurrentWindowPanel({
    windowSnapshot,
    isOpen,
    onClose,
    onFocusWindow,
    onSaveAsCollection,
    onCloseWindow,
    onTabsChanged,
}) {
    const [tabSearch, setTabSearch] = useState('');
    const [expandedGroupUids, setExpandedGroupUids] = useState(new Set());
    const [closingTabIds, setClosingTabIds] = useState(new Set());
    const [tabContextMenu, setTabContextMenu] = useState(null);
    const panelRef = useRef(null);
    const searchInputRef = useRef(null);
    const tabContextMenuRef = useRef(null);
    const { visibleTabs, items } = useMemo(
        () => buildVisibleItems(windowSnapshot, tabSearch),
        [windowSnapshot, tabSearch],
    );

    useEffect(() => {
        setTabSearch('');
        setClosingTabIds(new Set());
        setTabContextMenu(null);
        setExpandedGroupUids(new Set((windowSnapshot.chromeGroups || []).map((group) => group.uid)));
    }, [windowSnapshot.windowId, windowSnapshot.chromeGroups]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (tabContextMenu) {
                    setTabContextMenu(null);
                    return;
                }
                if (tabSearch) {
                    setTabSearch('');
                    return;
                }
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose, tabContextMenu, tabSearch]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!isOpen || !panelRef.current || panelRef.current.contains(event.target)) {
                return;
            }

            if (event.target.closest('.fp-tab-ctx-menu')) {
                return;
            }

            if (event.target.closest('.save-collection-modal-overlay') || event.target.closest('.current-window-close-modal-overlay')) {
                return;
            }

            onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (!tabContextMenu) {
            return undefined;
        }

        const closeMenu = () => setTabContextMenu(null);
        const handlePointerDown = (event) => {
            if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(event.target)) {
                closeMenu();
            }
        };
        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('scroll', closeMenu, true);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('scroll', closeMenu, true);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [tabContextMenu]);

    const handleToggleGroupExpanded = (groupUid) => {
        setExpandedGroupUids((previous) => {
            const next = new Set(previous);
            if (next.has(groupUid)) {
                next.delete(groupUid);
            } else {
                next.add(groupUid);
            }
            return next;
        });
    };

    const handleTabAction = async (tab, action) => {
        if (!tab) {
            return;
        }

        try {
            if (action === 'focus') {
                if (!tab.id) {
                    return;
                }

                await browser.windows.update(windowSnapshot.windowId, { focused: true });
                await browser.tabs.update(tab.id, { active: true });
                await onTabsChanged();
                return;
            }

            if (action === 'open') {
                if (!tab.url) {
                    return;
                }

                await browser.tabs.create({
                    windowId: browser.windows.WINDOW_ID_CURRENT,
                    url: tab.url,
                    active: true,
                });
                await onTabsChanged();
                return;
            }

            if (!tab.id) {
                return;
            }

            setClosingTabIds((previous) => new Set(previous).add(tab.id));
            await browser.tabs.remove(tab.id);
            await onTabsChanged();
        } catch (error) {
            const actionLabel = action === 'focus' ? 'focus' : action === 'open' ? 'open' : 'close';
            showErrorToast(`Failed to ${actionLabel} tab: ${error.message}`);
        } finally {
            if (action === 'close' && tab.id) {
                setClosingTabIds((previous) => {
                    const next = new Set(previous);
                    next.delete(tab.id);
                    return next;
                });
            }
        }
    };

    const handleTabContextMenu = (event, tab) => {
        event.preventDefault();
        event.stopPropagation();

        const menuWidth = 196;
        const menuHeight = 150;
        const pad = 8;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = event.clientX;
        let y = event.clientY;
        if (x + menuWidth + pad > viewportWidth) x = viewportWidth - menuWidth - pad;
        if (y + menuHeight + pad > viewportHeight) y = viewportHeight - menuHeight - pad;
        if (x < pad) x = pad;
        if (y < pad) y = pad;

        setTabContextMenu({ tab, x, y });
    };

    const handleContextAction = async (action) => {
        if (!tabContextMenu?.tab) {
            return;
        }

        const targetTab = tabContextMenu.tab;
        setTabContextMenu(null);
        await handleTabAction(targetTab, action);
    };

    const handleContextActionMouseDown = (action) => async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await handleContextAction(action);
    };

    const tabCount = windowSnapshot.tabs?.length || 0;
    const groupCount = windowSnapshot.chromeGroups?.length || 0;
    const favicons = (windowSnapshot.tabs || []).slice(0, 8).map((tab) => tab.favIconUrl).filter(Boolean);

    return (
        <div className={`panel-overlay ${isOpen ? 'visible' : ''}`}>
            <div
                ref={panelRef}
                className={`collection-detail-panel current-window-panel ${isOpen ? 'open' : ''}`}
            >
                <div className="panel-header">
                    <button className="panel-close-btn" onClick={onClose}>
                        <MdClose size={16} />
                        <span>Close</span>
                    </button>
                </div>

                <div className="panel-collection-info">
                    <div className="panel-color-bar current-window-panel-color-bar" />

                    <div className="panel-title-section">
                        <div className="panel-title-row">
                            <h2 className="panel-title">{windowSnapshot.name}</h2>
                            <FPBadge
                                accent="current-window"
                                className="current-window-live-badge"
                                leading={<MdOpenInBrowser size={14} />}
                            >
                                <span>Live Window</span>
                            </FPBadge>
                        </div>

                        <div className="panel-meta">
                            <span className="panel-meta-item">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
                            <span className="panel-meta-separator">•</span>
                            <span className="panel-meta-item">{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
                            <span className="panel-meta-separator">•</span>
                            <span className="panel-meta-item">{windowSnapshot.isCurrentWindow ? 'Focused' : 'Background'}</span>
                        </div>

                        {favicons.length > 0 && (
                            <div className="panel-favicons-preview">
                                {favicons.map((favicon, index) => (
                                    <img
                                        key={`${windowSnapshot.windowId}-panel-favicon-${index}`}
                                        src={favicon}
                                        alt=""
                                        className="panel-favicon"
                                        onError={(event) => { event.target.style.display = 'none'; }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="panel-actions">
                        <div className="panel-action-group">
                            <button
                                className="panel-action-btn primary"
                                onClick={() => onFocusWindow(windowSnapshot)}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Focus this window"
                            >
                                <MdCenterFocusWeak size={16} />
                                <span>Focus Window</span>
                            </button>

                            <button
                                className="panel-action-btn secondary"
                                onClick={() => onSaveAsCollection(windowSnapshot)}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Save this window as a collection"
                            >
                                <span>Save</span>
                            </button>

                            <button
                                className="panel-action-btn danger"
                                onClick={() => onCloseWindow(windowSnapshot)}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Close this window"
                            >
                                <MdClose size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {tabCount > 0 && (
                    <div className="panel-search-bar">
                        <MdSearch size={16} className="panel-search-icon" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="panel-search-input"
                            placeholder={`Search ${tabCount} tab${tabCount !== 1 ? 's' : ''}...`}
                            value={tabSearch}
                            onChange={(event) => setTabSearch(event.target.value)}
                        />
                        {tabSearch && (
                            <button
                                className="panel-search-clear"
                                onClick={() => {
                                    setTabSearch('');
                                    searchInputRef.current?.focus();
                                }}
                            >
                                <MdClose size={14} />
                            </button>
                        )}
                    </div>
                )}

                <div className="panel-content">
                    <div className="expanded-content current-window-panel-content">
                        {tabSearch?.trim() && visibleTabs.length > 0 ? (
                            <div className="search-results-indicator" onClick={(event) => event.stopPropagation()}>
                                <span className="search-results-text">
                                    Showing {visibleTabs.length} of {tabCount} tab{tabCount !== 1 ? 's' : ''} matching &quot;{tabSearch}&quot;
                                </span>
                            </div>
                        ) : null}

                        {items.length > 0 ? (
                            <div className="tabs-section current-window-tabs-section">
                                {items.map((item) => {
                                    if (item.type === 'group') {
                                        return (
                                            <CurrentWindowGroup
                                                key={item.group.uid}
                                                group={item.group}
                                                tabs={item.tabs}
                                                search={tabSearch}
                                                isExpanded={expandedGroupUids.has(item.group.uid)}
                                                onToggleExpanded={handleToggleGroupExpanded}
                                                onTabAction={handleTabAction}
                                                onTabContextMenu={handleTabContextMenu}
                                                activeContextTabUid={tabContextMenu?.tab?.uid || null}
                                                closingTabIds={closingTabIds}
                                            />
                                        );
                                    }

                                    return (
                                        <CurrentWindowTabRow
                                            key={item.tab.uid}
                                            tab={item.tab}
                                            search={tabSearch}
                                            isClosing={closingTabIds.has(item.tab.id)}
                                            isContextMenuActive={tabContextMenu?.tab?.uid === item.tab.uid}
                                            onTabAction={handleTabAction}
                                            onContextMenu={handleTabContextMenu}
                                        />
                                    );
                                })}
                            </div>
                        ) : tabSearch?.trim() ? (
                            <div className="current-window-empty">
                                <p>No tabs match &quot;{tabSearch}&quot; in this window.</p>
                            </div>
                        ) : (
                            <div className="current-window-empty">
                                <p>This window has no tabs.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {tabContextMenu && createPortal(
                <div
                    ref={tabContextMenuRef}
                    className="fp-tab-ctx-menu"
                    style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        className="fp-tab-ctx-item"
                        onMouseDown={handleContextActionMouseDown('focus')}
                    >
                        <MdCenterFocusWeak size={16} />
                        <span>Focus Tab</span>
                    </button>
                    <button
                        type="button"
                        className="fp-tab-ctx-item"
                        onMouseDown={handleContextActionMouseDown('open')}
                        disabled={!tabContextMenu.tab.url}
                    >
                        <MdOutlineOpenInBrowser size={16} />
                        <span>Open In Current Window</span>
                    </button>
                    <div className="fp-tab-ctx-divider" />
                    <button
                        type="button"
                        className="fp-tab-ctx-item danger"
                        onMouseDown={handleContextActionMouseDown('close')}
                    >
                        <MdClose size={16} />
                        <span>Close Tab</span>
                    </button>
                </div>,
                document.body,
            )}
        </div>
    );
}

export default FPCurrentWindowPanel;
