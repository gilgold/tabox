import React, { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { MdCenterFocusWeak, MdClose, MdOpenInBrowser } from 'react-icons/md';
import { selectedCurrentWindowIdState } from '../atoms/globalAppSettingsState';
import { browser } from '../../static/globals';
import { getMatchingTabs } from '../utils/searchUtils';
import FPCardBase from './FPCardBase';
import { CURRENT_WINDOWS_ACCENT_COLOR } from './fpAccentColors';
import './FPSessionCard.css';
import './FPCurrentWindowCard.css';

function FPCurrentWindowCard({
    windowSnapshot,
    onSelect,
    onFocusWindow,
    onSaveAsCollection,
    onCloseWindow,
    search = '',
    matchingTabs: matchingTabsProp = null,
}) {
    const selectedCurrentWindowId = useAtomValue(selectedCurrentWindowIdState);
    const isSelected = selectedCurrentWindowId === windowSnapshot.windowId;
    const tabCount = windowSnapshot.tabs?.length || 0;
    const groupCount = windowSnapshot.chromeGroups?.length || 0;
    const matchingTabs = useMemo(() => (
        matchingTabsProp || getMatchingTabs(windowSnapshot, search)
    ), [matchingTabsProp, search, windowSnapshot]);

    const handleAction = (callback) => () => {
        callback(windowSnapshot);
    };

    const handleOpenMatchingTab = useCallback(async (tab) => {
        if (!tab?.id) {
            return;
        }

        await browser.windows.update(windowSnapshot.windowId, { focused: true });
        await browser.tabs.update(tab.id, { active: true });
    }, [windowSnapshot.windowId]);

    return (
        <FPCardBase
            className={[
                'fp-session-card',
                'fp-current-window-card',
                isSelected ? 'fp-card-selected fp-current-window-card-selected' : '',
            ].filter(Boolean).join(' ')}
            style={{
                '--fp-current-windows-accent': CURRENT_WINDOWS_ACCENT_COLOR,
                '--card-color': 'var(--fp-current-windows-accent)',
            }}
            onClick={() => onSelect(windowSnapshot)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(windowSnapshot);
                }
            }}
            title={windowSnapshot.name}
            titleText={windowSnapshot.name}
            titleBadges={(
                <div className="fp-card-badges">
                    <div className="fp-card-badge fp-card-badge-label">
                        <MdOpenInBrowser size={12} />
                        <span>Live Window</span>
                    </div>
                </div>
            )}
            meta={(
                <>
                    <span className="fp-card-meta-chip tabs">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
                    {groupCount > 0 && (
                        <span className="fp-card-meta-chip groups">{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
                    )}
                    {!!search?.trim() && matchingTabs.length > 0 && (
                        <span className="fp-card-meta-chip fp-card-meta-match-badge">
                            {matchingTabs.length} tab match{matchingTabs.length !== 1 ? 'es' : ''}
                        </span>
                    )}
                    <span className={`fp-card-meta-chip current-window-status ${windowSnapshot.isCurrentWindow ? 'active' : ''}`}>
                        {windowSnapshot.isCurrentWindow ? 'Focused' : 'Background'}
                    </span>
                </>
            )}
            timeLabel="Live now"
            tabs={windowSnapshot.tabs || []}
            matchingTabs={matchingTabs}
            search={search}
            onOpenMatchingTab={handleOpenMatchingTab}
            matchingTabsResetKey={windowSnapshot.windowId}
            actions={(
                <>
                    <button
                        className="fp-card-action-btn primary"
                        onClick={handleAction(onFocusWindow)}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Focus this window"
                    >
                        <MdCenterFocusWeak size={14} />
                        <span>Focus</span>
                    </button>
                    <button
                        className="fp-card-action-btn save"
                        onClick={handleAction(onSaveAsCollection)}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Save this window as a collection"
                    >
                        <span>Save</span>
                    </button>
                    <button
                        className="fp-card-action-btn close"
                        onClick={handleAction(onCloseWindow)}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Close this window"
                    >
                        <MdClose size={14} />
                        <span>Close</span>
                    </button>
                </>
            )}
        />
    );
}

export default FPCurrentWindowCard;
