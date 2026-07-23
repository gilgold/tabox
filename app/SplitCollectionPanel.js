import React, { useState, useEffect } from 'react';
import { MdFolder, MdExpandMore, MdChevronRight } from 'react-icons/md';
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
    // Which result cards are collapsed (header only). Default: all expanded.
    const [collapsed, setCollapsed] = useState({});
    // Picker (collection chooser): which candidate cards are expanded to preview
    // their tabs (uid → bool). Default: all collapsed. Plus per-uid "show all".
    const [pickerOpen, setPickerOpen] = useState({});
    const [pickerShowAll, setPickerShowAll] = useState({});

    // Reset editable state whenever a new ok result arrives
    useEffect(() => {
        if (results && results.ok) {
            setNames((results.groups || []).map(g => g.name));
            setGroupIntoFolder(true);
            setFolderName(results.name || '');
            setSubmitting(false);
            setExpanded({});
            setCollapsed({});
        }
    }, [results]);

    // ── Running ──────────────────────────────────────────────────────────────
    if (status === 'running') {
        // Two-phase scans report per-batch progress (filed/total tabs); show it
        // once assignment starts. filed stays 0 through the themes call, so the
        // counter never renders as a static "0/N".
        const filed = aiTaskState?.filed || 0;
        const total = aiTaskState?.total || 0;
        return (
            <div className="split-panel split-panel--running">
                <SplitScanAnimation />
                <p className="split-panel-status">
                    Scanning tabs and proposing sub-collections…
                    {filed > 0 && total > 0 && (
                        <span className="split-panel-progress">{` ${Math.min(filed, total)}/${total} tabs`}</span>
                    )}
                </p>
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
        const toggleCollapsed = (i) => {
            setCollapsed(prev => ({ ...prev, [i]: !prev[i] }));
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
                            const isCollapsed = !!collapsed[i];
                            const shown = isExpanded ? tabs : tabs.slice(0, MAX_TABS_SHOWN);
                            const extra = tabs.length - shown.length;
                            return (
                                <div key={i} className={`split-card${isCollapsed ? '' : ' split-card--open'}`}>
                                    <div
                                        className="split-card-head"
                                        onClick={() => toggleCollapsed(i)}
                                        role="button"
                                        aria-expanded={!isCollapsed}
                                    >
                                        <MdFolder className="split-card-folder" size={16} />
                                        <input
                                            type="text"
                                            className="split-card-name"
                                            aria-label={`Sub-collection ${i + 1} name`}
                                            value={names[i] !== undefined ? names[i] : group.name}
                                            onChange={e => handleNameChange(i, e.target.value)}
                                            onClick={e => e.stopPropagation()}
                                        />
                                        <span className="split-card-count">{tabs.length} tabs</span>
                                        {isCollapsed
                                            ? <MdChevronRight className="split-card-chevron" size={18} />
                                            : <MdExpandMore className="split-card-chevron" size={18} />}
                                    </div>
                                    {!isCollapsed && (
                                        <div className="split-card-body">
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
                                            {tabs.length > MAX_TABS_SHOWN && (
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
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="split-footer">
                    <div className="split-folder">
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

    const togglePicker = (uid) => {
        setPickerOpen(prev => ({ ...prev, [uid]: !prev[uid] }));
    };
    const togglePickerShowAll = (uid) => {
        setPickerShowAll(prev => ({ ...prev, [uid]: !prev[uid] }));
    };

    if (candidates.length === 0) {
        return (
            <div className="split-panel">
                <p className="split-panel-status">No collections are large enough to split yet.</p>
            </div>
        );
    }

    return (
        <div className="split-panel split-panel--results">
            <p className="split-panel-status">Pick a large collection to split (30+ tabs).</p>
            <div className="split-scroll">
                <div className="split-cards">
                    {candidates.map(c => {
                        const tabs = c.tabs || [];
                        const open = !!pickerOpen[c.uid];
                        const showAll = !!pickerShowAll[c.uid];
                        const shown = showAll ? tabs : tabs.slice(0, MAX_TABS_SHOWN);
                        const extra = tabs.length - shown.length;
                        return (
                            <div key={c.uid} className={`split-card${open ? ' split-card--open' : ''}`}>
                                <div
                                    className="split-card-head"
                                    onClick={() => togglePicker(c.uid)}
                                    role="button"
                                    aria-expanded={open}
                                >
                                    <MdFolder className="split-card-folder" size={16} />
                                    <span className="split-candidate-name">{c.name}</span>
                                    <span className="split-card-count">{tabs.length} tabs</span>
                                    <button
                                        type="button"
                                        className="split-candidate-go"
                                        onClick={e => { e.stopPropagation(); onStartScan(c.uid); }}
                                    >
                                        Split
                                    </button>
                                    {open
                                        ? <MdExpandMore className="split-card-chevron" size={18} />
                                        : <MdChevronRight className="split-card-chevron" size={18} />}
                                </div>
                                {open && (
                                    <div className="split-card-body">
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
                                        {tabs.length > MAX_TABS_SHOWN && (
                                            <button
                                                type="button"
                                                className="split-card-more"
                                                onClick={() => togglePickerShowAll(c.uid)}
                                                aria-expanded={showAll}
                                            >
                                                {showAll ? 'Show less' : `+${extra} more`}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default SplitCollectionPanel;
