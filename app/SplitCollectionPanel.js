import React, { useState, useEffect } from 'react';
import { SPLIT_MIN_TABS, FALLBACK_FAVICON } from './utils/sharedConstants';
import SplitScanAnimation from './SplitScanAnimation';
import AiSuggestNameButton from './AiSuggestNameButton';
import { suggestFolderName } from './ai/tasks/suggestFolderName';
import './SplitCollectionPanel.css';

const MAX_TABS_SHOWN = 8;

function SplitCollectionPanel({
    collections = [],
    target,
    aiTaskState,
    busy = false,
    onStartScan,
    onConfirm,
    onCancel,
}) {
    const status = aiTaskState?.status;
    const results = aiTaskState?.results;

    // Local editable state for review panel
    const [names, setNames] = useState([]);
    const [groupIntoFolder, setGroupIntoFolder] = useState(true);
    const [folderName, setFolderName] = useState('');
    // UX guard: prevent the confirm button from being mashed while submitting.
    const [submitting, setSubmitting] = useState(false);
    // Which result cards have their full tab list expanded (index → bool).
    const [expanded, setExpanded] = useState({});

    // Reset editable state whenever a new ok result arrives
    useEffect(() => {
        if (results && results.ok) {
            setNames((results.groups || []).map(g => g.name));
            setGroupIntoFolder(true);
            setFolderName(results.name || '');
            setSubmitting(false);
            setExpanded({});
        }
    }, [results]);

    // ── Running ──────────────────────────────────────────────────────────────
    if (status === 'running') {
        return (
            <div className="split-panel split-panel--running">
                <SplitScanAnimation />
                <p className="split-panel-status">Scanning tabs and proposing sub-collections…</p>
            </div>
        );
    }

    // ── Results: ok:false ────────────────────────────────────────────────────
    if (results && !results.ok) {
        return (
            <div className="split-panel">
                <p className="split-panel-status">
                    We couldn&apos;t find a good way to split this collection.
                </p>
                <div className="split-actions">
                    <button
                        type="button"
                        className="ai-tool-action-btn ai-tool-action-btn--cancel"
                        onClick={onCancel}
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    // ── Results: ok:true (review) ────────────────────────────────────────────
    if (results && results.ok) {
        const groups = results.groups || [];

        const handleNameChange = (i, value) => {
            setNames(prev => {
                const next = [...prev];
                next[i] = value;
                return next;
            });
        };

        const handleConfirm = () => {
            setSubmitting(true);
            onConfirm({
                uid: results.uid,
                plan: {
                    groups: groups.map((g, i) => ({
                        name: (names[i] || g.name).trim() || g.name,
                        tabIndices: g.tabIndices,
                    })),
                },
                folder: groupIntoFolder
                    ? { name: (folderName || results.name).trim() || results.name }
                    : null,
            });
        };

        const toggleExpanded = (i) => {
            setExpanded(prev => ({ ...prev, [i]: !prev[i] }));
        };

        return (
            <div className="split-panel split-panel--results">
                <p className="split-panel-status">
                    Review the {groups.length} sub-collections below, then confirm to replace the original.
                </p>

                <div className="split-scroll">
                    <div className="split-cards">
                        {groups.map((group, i) => {
                            const tabs = group.tabs || [];
                            const isExpanded = !!expanded[i];
                            const shown = isExpanded ? tabs : tabs.slice(0, MAX_TABS_SHOWN);
                            const extra = tabs.length - shown.length;
                            return (
                                <div key={i} className="split-card">
                                    <div className="split-card-head">
                                        <input
                                            type="text"
                                            className="split-card-name"
                                            aria-label={`Sub-collection ${i + 1} name`}
                                            value={names[i] !== undefined ? names[i] : group.name}
                                            onChange={e => handleNameChange(i, e.target.value)}
                                        />
                                        <span className="split-card-count">{tabs.length} tabs</span>
                                    </div>
                                    <ul className="split-card-tabs">
                                        {shown.map((t, ti) => (
                                            <li key={ti}>
                                                <img
                                                    src={t.favIconUrl || FALLBACK_FAVICON}
                                                    alt=""
                                                    width={14}
                                                    height={14}
                                                    onError={e => { e.currentTarget.src = FALLBACK_FAVICON; }}
                                                />
                                                <span>{t.title || t.url}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {(extra > 0 || isExpanded) && tabs.length > MAX_TABS_SHOWN && (
                                        <button
                                            type="button"
                                            className="split-card-more"
                                            onClick={() => toggleExpanded(i)}
                                            aria-expanded={isExpanded}
                                        >
                                            {isExpanded ? 'Show less' : `+${extra} more`}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <label className="split-folder-toggle">
                        <input
                            type="checkbox"
                            checked={groupIntoFolder}
                            onChange={e => setGroupIntoFolder(e.target.checked)}
                            aria-label="Group these into a folder"
                        />
                        Group these into a folder
                    </label>

                    {groupIntoFolder && (
                        <div className="split-folder-row">
                            <input
                                type="text"
                                className="split-folder-name"
                                aria-label="Folder name"
                                value={folderName}
                                onChange={e => setFolderName(e.target.value)}
                            />
                            <AiSuggestNameButton
                                suggest={() => suggestFolderName({
                                    collections: groups.map((g, i) => ({
                                        name: names[i] || g.name,
                                        tabs: g.tabs,
                                    })),
                                })}
                                onSuggested={setFolderName}
                                label="Suggest folder name with AI"
                            />
                        </div>
                    )}
                </div>

                <div className="split-actions">
                    <button
                        type="button"
                        className="ai-tool-action-btn ai-tool-action-btn--cancel"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="ai-tool-action-btn"
                        onClick={handleConfirm}
                        disabled={submitting || busy}
                    >
                        Confirm split
                    </button>
                </div>
            </div>
        );
    }

    // ── Target set but no results yet ────────────────────────────────────────
    if (target) {
        return (
            <div className="split-panel">
                <p className="split-panel-status">Preparing to scan…</p>
            </div>
        );
    }

    // ── Picker ───────────────────────────────────────────────────────────────
    const candidates = collections
        .filter(c => c.tabs && c.tabs.length >= SPLIT_MIN_TABS)
        .sort((a, b) => b.tabs.length - a.tabs.length);

    return (
        <div className="split-panel">
            <p className="split-panel-status">Pick a large collection to split (30+ tabs).</p>
            {candidates.length === 0 ? (
                <p className="split-panel-status">No collections are large enough to split yet.</p>
            ) : (
                <ul className="split-candidate-list">
                    {candidates.map(c => (
                        <li key={c.uid}>
                            <button
                                type="button"
                                className="split-candidate"
                                onClick={() => onStartScan(c.uid)}
                            >
                                <span>{c.name}</span>
                                <span className="split-candidate-count">{c.tabs.length} tabs</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default SplitCollectionPanel;
