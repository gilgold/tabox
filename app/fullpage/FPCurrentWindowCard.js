import React, { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { MdCenterFocusWeak, MdClose, MdOpenInBrowser, MdSave } from 'react-icons/md';
import { selectedCurrentWindowIdState } from '../atoms/globalAppSettingsState';
import { browser } from '../../static/globals';
import { getMatchingTabs } from '../utils/searchUtils';
import FPCardBase from './FPCardBase';
import FPCardHoverActions, { FP_CARD_HOVER_MENU_CLASS } from './FPCardHoverActions';
import { CURRENT_WINDOWS_ACCENT_COLOR } from './fpAccentColors';
import FPBadge from './FPBadge';
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
                    <FPBadge
                        accent="current-window"
                        className="fp-card-badge fp-card-badge-label"
                        leading={<MdOpenInBrowser size={12} />}
                    >
                        <span>Live Window</span>
                    </FPBadge>
                </div>
            )}
            meta={(
                <>
                    <FPBadge accent="tabs" className="fp-card-meta-chip tabs">{tabCount} tab{tabCount !== 1 ? 's' : ''}</FPBadge>
                    {groupCount > 0 && (
                        <FPBadge accent="groups" className="fp-card-meta-chip groups">{groupCount} group{groupCount !== 1 ? 's' : ''}</FPBadge>
                    )}
                    {!!search?.trim() && matchingTabs.length > 0 && (
                        <FPBadge accent="match" className="fp-card-meta-chip fp-card-meta-match-badge">
                            {matchingTabs.length} tab match{matchingTabs.length !== 1 ? 'es' : ''}
                        </FPBadge>
                    )}
                    <FPBadge
                        accent={windowSnapshot.isCurrentWindow ? 'success' : 'neutral'}
                        className={`fp-card-meta-chip current-window-status ${windowSnapshot.isCurrentWindow ? 'active' : ''}`}
                    >
                        {windowSnapshot.isCurrentWindow ? 'Focused' : 'Background'}
                    </FPBadge>
                </>
            )}
            timeLabel="Live now"
            tabs={windowSnapshot.tabs || []}
            matchingTabs={matchingTabs}
            search={search}
            onOpenMatchingTab={handleOpenMatchingTab}
            matchingTabsResetKey={windowSnapshot.windowId}
            actions={(
                <FPCardHoverActions
                    items={[
                        {
                            key: 'focus',
                            className: 'fp-card-rail-open fp-card-rail-focus',
                            label: 'Focus',
                            tooltip: 'Focus this window',
                            icon: <MdCenterFocusWeak size={14} />,
                            onClick: handleAction(onFocusWindow),
                        },
                        {
                            key: 'save',
                            className: 'fp-card-rail-save',
                            label: 'Save',
                            tooltip: 'Save this window as a collection',
                            icon: <MdSave size={13} />,
                            onClick: handleAction(onSaveAsCollection),
                        },
                        {
                            key: 'close',
                            className: 'fp-card-rail-delete fp-card-rail-close',
                            label: 'Close',
                            tooltip: 'Close this window',
                            icon: <MdClose size={14} />,
                            onClick: handleAction(onCloseWindow),
                        },
                    ]}
                />
            )}
            actionsClassName={FP_CARD_HOVER_MENU_CLASS}
        />
    );
}

export default FPCurrentWindowCard;
