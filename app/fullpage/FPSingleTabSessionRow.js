import React, { useMemo } from 'react';
import { MdHistory, MdOpenInNew, MdSave } from 'react-icons/md';
import TimeAgo from 'javascript-time-ago';
import MultiSelectCheckbox from '../MultiSelectCheckbox';
import { highlightText } from '../utils/searchUtils';
import { restoreBrowserSession } from '../utils/browserSessions';
import FPBadge from './FPBadge';
import './FPSingleTabSessionRow.css';

const formatUrlPreview = (url) => {
    if (!url) {
        return '';
    }

    return url.length > 84 ? `${url.slice(0, 83)}...` : url;
};

function FPSingleTabSessionRow({
    collection,
    sessionTimestamp,
    search = '',
    isSelected = false,
    selectionEnabled = false,
    onToggleSelected,
    onSaveAsCollection,
}) {
    const timeAgo = useMemo(() => new TimeAgo('en-US'), []);
    const tab = collection?.tabs?.[0] || null;
    const title = tab?.title || collection?.name || 'Recently closed tab';
    const url = tab?.url || '';
    const timeLabel = (() => {
        try {
            return timeAgo.format(new Date(sessionTimestamp));
        } catch {
            return 'Recently';
        }
    })();

    const handleRestore = async () => {
        await restoreBrowserSession(collection);
    };

    const handleToggleSelection = (event) => {
        event.stopPropagation();
        onToggleSelected?.(collection, sessionTimestamp);
    };

    const handleSave = (event) => {
        event.stopPropagation();
        onSaveAsCollection?.(collection);
    };

    return (
        <div
            className={[
                'fp-single-tab-session-row',
                isSelected ? 'is-selected' : '',
                selectionEnabled ? 'selection-enabled' : '',
            ].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            onClick={handleRestore}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleRestore();
                }
            }}
        >
            <MultiSelectCheckbox
                className="fp-single-tab-session-checkbox"
                checked={isSelected}
                aria-label={isSelected ? 'Deselect tab session' : 'Select tab session'}
                accentColor="#f59e0b"
                onClick={handleToggleSelection}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            />

            <div className="fp-single-tab-session-favicon">
                <img
                    src={tab?.favIconUrl || './images/favicon-fallback.png'}
                    alt=""
                    onError={(event) => {
                        event.target.src = './images/favicon-fallback.png';
                    }}
                />
            </div>

            <div className="fp-single-tab-session-main">
                <div className="fp-single-tab-session-title-row">
                    <FPBadge
                        accent="session"
                        className="fp-single-tab-session-badge"
                        leading={<MdHistory size={12} />}
                    >
                        <span>Tab</span>
                    </FPBadge>
                    <span className="fp-single-tab-session-title" title={title}>
                        {highlightText(title, search, 'fp-single-tab-session-search-match') || title}
                    </span>
                </div>

                <div className="fp-single-tab-session-url" title={url}>
                    {highlightText(formatUrlPreview(url), search, 'fp-single-tab-session-search-match') || formatUrlPreview(url)}
                </div>
            </div>

            <div className="fp-single-tab-session-time">
                {timeLabel}
            </div>

            <div
                className="fp-single-tab-session-actions"
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className="fp-session-action-btn fp-session-action-btn-restore"
                    onClick={handleRestore}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Restore this tab"
                >
                    <MdOpenInNew size={14} />
                    <span>Restore</span>
                </button>
                <button
                    type="button"
                    className="fp-session-action-btn fp-session-action-btn-save"
                    onClick={handleSave}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Save this tab as a collection"
                >
                    <MdSave size={14} />
                    <span>Save as Collection</span>
                </button>
            </div>
        </div>
    );
}

export default FPSingleTabSessionRow;
