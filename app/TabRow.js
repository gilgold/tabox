import React, { memo, useCallback, useMemo } from 'react';
import { browser } from '../static/globals';
import { AiFillPushpin } from 'react-icons/ai';
import { FaVolumeMute } from 'react-icons/fa';
import { MdDeleteForever, MdOutlineOpenInNew, MdDragIndicator } from 'react-icons/md';
import { getColorCode } from './utils';

const TabRow = memo(({ tab, updateCollection, collection, group = null, isDragging = false, search = null }) => {
    const fallbackFavicon = './images/favicon-fallback.png';

    // Helper function to escape regex special characters
    const escapeRegex = (string) => {
        return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    };

    // Helper function to highlight matching text in tab title
    const highlightMatchInTitle = useMemo(() => {
        if (!search || !search.trim() || !tab.title) {
            return null;
        }
        
        const title = tab.title;
        const searchTerm = search.trim();
        
        // Check if title matches search (case-insensitive)
        const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
        if (!title || !title.match(searchRegex)) {
            return null;
        }
        
        const escapedSearch = escapeRegex(searchTerm);
        const highlightRegex = new RegExp(`(${escapedSearch})`, 'gi');
        const parts = title.split(highlightRegex);
        
        return parts.map((part, index) => {
            // Check if this part matches the search term (case-insensitive)
            if (part.toLowerCase() === searchTerm.toLowerCase()) {
                return (
                    <span key={`match-${index}-${part}`} className="search-match-text">
                        {part}
                    </span>
                );
            }
            return part ? <span key={`text-${index}-${part}`}>{part}</span> : null;
        }).filter(Boolean);
    }, [search, tab.title]);

    const handleTabDelete = useCallback(() => {
        let currentCollection = { ...collection };
        let newTabList = [...currentCollection.tabs].filter(t => t.uid !== tab.uid)
        let newChromeGroups = [...currentCollection.chromeGroups];
        if (tab.groupUid) {
            const totalTabsInGroup = newTabList.filter(el => el.groupUid === tab.groupUid).length;
            if (totalTabsInGroup === 0) {
                newChromeGroups = newChromeGroups.filter(cg => cg.uid !== tab.groupUid)
            }
        }
        currentCollection.tabs = newTabList;
        currentCollection.chromeGroups = newChromeGroups;
        currentCollection.lastUpdated = Date.now();
        updateCollection(currentCollection, true); // Manual tab deletion - trigger lightning effect
    }, [collection, tab.uid, tab.groupUid, updateCollection]);

    const handleFaviconError = useCallback((e) => {
        e.target.src = fallbackFavicon;
    }, [fallbackFavicon]);

    const handleOpenTab = useCallback(async (tabToOpen) => {
        const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
        if (chkOpenNewWindow) {
            await browser.windows.create({ focused: true, url: tabToOpen.url });
        } else {
            await browser.tabs.create({ url: tabToOpen.url, active: true });
        }
    }, []);

    // Memoize expensive computations
    const groupIndicatorStyle = useMemo(() => ({
        backgroundColor: group ? getColorCode(group.color) : 'transparent',
        boxShadow: group ? `${getColorCode(group.color)} -3px 1px 3px -2px` : 'none'
    }), [group]);

    const faviconSrc = useMemo(() => {
        if (tab.favIconUrl) return tab.favIconUrl;
        if (tab?.url && /\.(jpg|jpeg|gif|png|ico|tiff)$/.test(tab.url.split('?')[0])) return tab.url;
        return fallbackFavicon;
    }, [tab.favIconUrl, tab.url, fallbackFavicon]);

    return (
        <div className='tab-line' id={`tab-line-${tab.uid}`} key={`tab-line-${tab.uid}`}>
            <div className={`row single-tab-row ${isDragging ? 'tab-row-dragging' : ''} ${tab.pinned ? 'pinned-tab' : ''}`} key={`line-${tab.uid}`}>
                {(tab.groupId > -1 && group) ?
                    <div
                        className="group-indicator"
                        style={groupIndicatorStyle}
                    /> :
                    <div className="group-placeholder" />}
                
                {/* Drag Handle */}
                <div className="drag-handle" title={tab.pinned ? "Cannot drag pinned tab" : "Drag to reorder tab"}>
                    <MdDragIndicator size="14px" color="var(--text-color)" />
                </div>
                
                {/* Tab Indicators Container */}
                {(tab.pinned || tab.mutedInfo?.muted) && (
                    <div className="tab-indicators-container">
                        {/* Flat Pinned Tab Indicator */}
                        {tab.pinned && (
                            <div className="tab-property pinned-tab modern-pinned" title="Pinned Tab">
                                <div className="pinned-icon-wrapper">
                                    <AiFillPushpin size="10px" />
                                </div>
                            </div>
                        )}
                        
                        {/* Flat Muted Tab Indicator */}
                        {tab.mutedInfo?.muted && (
                            <div className="tab-property muted-tab modern-muted" title="Muted Tab">
                                <div className="muted-icon-wrapper">
                                    <FaVolumeMute size="10px" />
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                <div className="column favicon-col">
                    <img 
                        onError={handleFaviconError} 
                        className="tab-favicon" 
                        src={faviconSrc}
                        alt="Site favicon"
                    />
                </div>
                <div className="column single-tab-title-col">
                    <span className="single-tab-title" title={tab.title}>
                        {highlightMatchInTitle !== null ? highlightMatchInTitle : tab.title}
                    </span>
                </div>
                <div className="column actions-col">
                    <button 
                        className="action-button" 
                        data-tip="Open this tab" 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            handleOpenTab(tab); 
                        }}
                    >
                        <MdOutlineOpenInNew size="16px" color="var(--primary-color)" />
                    </button>
                    <button 
                        className="action-button del-tab" 
                        data-tip="Delete this tab" 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            handleTabDelete(); 
                        }}
                    >
                        <MdDeleteForever color="#B64A4A" size="20" />
                    </button>
                </div>
            </div>
        </div>
    );
});

export default TabRow;