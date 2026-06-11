import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MdClose, MdExpandLess, MdExpandMore, MdHistory, MdOpenInNew, MdSearch, MdSave } from 'react-icons/md';
import TimeAgo from 'javascript-time-ago';
import { getColorCode } from '../utils';
import { highlightText } from '../utils/searchUtils';
import { showErrorToast } from '../toastHelpers';
import { restoreBrowserSession } from '../utils/browserSessions';
import { FALLBACK_FAVICON } from '../utils/sharedConstants';
import ClickableTabUrl from './ClickableTabUrl';
import FPBadge from './FPBadge';
import '../CollectionDetailPanel.css';
import './FPCurrentWindowPanel.css';
import './FPSessionPanel.css';

const formatUrlPreview = (url) => {
    if (!url) {
        return '';
    }
    return url.length > 96 ? `${url.slice(0, 95)}...` : url;
};

const buildVisibleItems = (sessionCollection, search) => {
    const searchTerm = search?.trim()?.toLowerCase() || '';
    const visibleTabs = searchTerm
        ? (sessionCollection.tabs || []).filter((tab) => (
            tab.title?.toLowerCase().includes(searchTerm) || tab.url?.toLowerCase().includes(searchTerm)
        ))
        : (sessionCollection.tabs || []);
    const groupsByUid = new Map((sessionCollection.chromeGroups || []).map((group) => [group.uid, group]));
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

function SessionTabRow({ tab, groupColor = null, search }) {
    return (
        <div className="tab-line current-window-tab-line" id={`session-tab-line-${tab.uid}`}>
            <div className={`row single-tab-row current-window-tab-row ${tab.pinned ? 'pinned-tab' : ''}`}>
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
            </div>
        </div>
    );
}

function SessionGroup({ group, tabs, search, isExpanded, onToggleExpanded }) {
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
                        <SessionTabRow
                            key={tab.uid}
                            tab={tab}
                            groupColor={groupColor}
                            search={search}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FPSessionPanel({
    sessionCollection,
    sessionTimestamp,
    isOpen,
    onClose,
    onSaveAsCollection,
    onRestoreWindow,
}) {
    const [tabSearch, setTabSearch] = useState('');
    const [expandedGroupUids, setExpandedGroupUids] = useState(new Set());
    const panelRef = useRef(null);
    const searchInputRef = useRef(null);
    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    const { visibleTabs, items } = useMemo(
        () => buildVisibleItems(sessionCollection, tabSearch),
        [sessionCollection, tabSearch],
    );

    useEffect(() => {
        setTabSearch('');
        setExpandedGroupUids(new Set((sessionCollection.chromeGroups || []).map((group) => group.uid)));
    }, [sessionCollection, sessionTimestamp]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (tabSearch) {
                    setTabSearch('');
                    return;
                }
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose, tabSearch]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!isOpen || !panelRef.current || panelRef.current.contains(event.target)) {
                return;
            }

            if (event.target.closest('.save-collection-modal-overlay')) {
                return;
            }

            onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

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

    const handleRestore = async () => {
        try {
            await restoreBrowserSession(sessionCollection);
            await onRestoreWindow?.();
        } catch (error) {
            showErrorToast(`Failed to restore item: ${error.message}`);
        }
    };

    const tabCount = sessionCollection.tabs?.length || 0;
    const groupCount = sessionCollection.chromeGroups?.length || 0;
    const favicons = (sessionCollection.tabs || []).slice(0, 8).map((tab) => tab.favIconUrl).filter(Boolean);
    const sessionLabel = (() => {
        try {
            return timeAgo.format(new Date(sessionTimestamp));
        } catch {
            return 'Recently closed';
        }
    })();

    return (
        <div className={`panel-overlay ${isOpen ? 'visible' : ''}`}>
            <div
                ref={panelRef}
                className={`collection-detail-panel current-window-panel session-panel ${isOpen ? 'open' : ''}`}
            >
                <div className="panel-header">
                    <button className="panel-close-btn" onClick={onClose}>
                        <MdClose size={16} />
                        <span>Close</span>
                    </button>
                </div>

                <div className="panel-collection-info">
                    <div className="panel-color-bar current-window-panel-color-bar session-panel-color-bar" />

                    <div className="panel-title-section">
                        <div className="panel-title-row">
                            <h2 className="panel-title">{sessionCollection.name || 'Recently closed item'}</h2>
                            <FPBadge
                                accent="session"
                                className="current-window-live-badge session-panel-badge"
                                leading={<MdHistory size={14} />}
                            >
                                <span>Recently Closed</span>
                            </FPBadge>
                        </div>

                        <div className="panel-meta">
                            <span className="panel-meta-item">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
                            <span className="panel-meta-separator">•</span>
                            <span className="panel-meta-item">{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
                            <span className="panel-meta-separator">•</span>
                            <span className="panel-meta-item">{sessionLabel}</span>
                        </div>

                        {favicons.length > 0 && (
                            <div className="panel-favicons-preview">
                                {favicons.map((favicon, index) => (
                                    <img
                                        key={`${sessionCollection.uid}-panel-favicon-${index}`}
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
                                onClick={handleRestore}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Restore this item"
                            >
                                <MdOpenInNew size={16} />
                                <span>Restore</span>
                            </button>

                            <button
                                className="panel-action-btn secondary"
                                onClick={() => onSaveAsCollection(sessionCollection)}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="Save this item as a collection"
                            >
                                <MdSave size={16} />
                                <span>Save</span>
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
                                            <SessionGroup
                                                key={item.group.uid}
                                                group={item.group}
                                                tabs={item.tabs}
                                                search={tabSearch}
                                                isExpanded={expandedGroupUids.has(item.group.uid)}
                                                onToggleExpanded={handleToggleGroupExpanded}
                                            />
                                        );
                                    }

                                    return (
                                        <SessionTabRow
                                            key={item.tab.uid}
                                            tab={item.tab}
                                            search={tabSearch}
                                        />
                                    );
                                })}
                            </div>
                        ) : tabSearch?.trim() ? (
                            <div className="current-window-empty">
                                <p>No tabs match &quot;{tabSearch}&quot; in this session window.</p>
                            </div>
                        ) : (
                            <div className="current-window-empty">
                                <p>This session window has no tabs.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default FPSessionPanel;
