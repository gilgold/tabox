import React, { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { MdHistory, MdOpenInNew, MdSave } from 'react-icons/md';
import { selectedSessionEntryKeyState } from '../atoms/globalAppSettingsState';
import TimeAgo from 'javascript-time-ago';
import { browser } from '../../static/globals';
import { getMatchingTabs } from '../utils/searchUtils';
import { getBrowserSessionEntryKey, restoreBrowserSession } from '../utils/browserSessions';
import FPCardBase from './FPCardBase';
import './FPSessionCard.css';

function FPSessionCard({
    collection,
    sessionTimestamp,
    onSelect,
    onSaveAsCollection,
    search = '',
    matchingTabs: matchingTabsProp = null,
}) {
    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    const selectedSessionEntryKey = useAtomValue(selectedSessionEntryKeyState);
    const tabCount = collection.tabs?.length || 0;
    const groupCount = collection.chromeGroups?.length || 0;
    const sessionEntryKey = getBrowserSessionEntryKey(collection, sessionTimestamp);
    const isSelected = selectedSessionEntryKey === sessionEntryKey;
    const matchingTabs = useMemo(() => (
        matchingTabsProp || getMatchingTabs(collection, search)
    ), [collection, matchingTabsProp, search]);
    const title = `${tabCount} tab${tabCount !== 1 ? 's' : ''}${groupCount > 0 ? ` (${groupCount} group${groupCount !== 1 ? 's' : ''})` : ''}`;

    const formatTimeAgo = (timestamp) => {
        try { return timeAgo.format(new Date(timestamp)); }
        catch { return 'Recently'; }
    };

    const handleRestore = async () => {
        await restoreBrowserSession(collection);
    };

    return (
        <FPCardBase
            className={[
                'fp-session-card',
                isSelected ? 'fp-card-selected fp-session-card-selected' : '',
            ].filter(Boolean).join(' ')}
            style={{ '--card-color': '#f59e0b' }}
            onClick={() => onSelect?.(collection, sessionTimestamp)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(collection, sessionTimestamp);
                }
            }}
            title={title}
            titleText={title}
            titleBadges={(
                <div className="fp-card-badges">
                    <div className="fp-card-badge fp-card-badge-label">
                        <MdHistory size={12} />
                        <span>Recently closed</span>
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
                </>
            )}
            timeLabel={formatTimeAgo(sessionTimestamp)}
            tabs={collection.tabs || []}
            matchingTabs={matchingTabs}
            search={search}
            onOpenMatchingTab={async (tab) => {
                if (tab.url) {
                    await browser.tabs.create({ url: tab.url, active: true });
                }
            }}
            matchingTabsResetKey={sessionEntryKey}
            actionMenu={null}
            actions={(
                <>
                    <button
                        className="fp-card-action-btn fp-session-action-btn fp-session-action-btn-restore"
                        onClick={handleRestore}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Restore this item"
                    >
                        <MdOpenInNew size={14} />
                        <span>Restore</span>
                    </button>
                    <button
                        className="fp-card-action-btn fp-session-action-btn fp-session-action-btn-save"
                        onClick={() => onSaveAsCollection(collection)}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Save as a new collection"
                    >
                        <MdSave size={14} />
                        <span>Save as Collection</span>
                    </button>
                </>
            )}
        />
    );
}

export default FPSessionCard;
