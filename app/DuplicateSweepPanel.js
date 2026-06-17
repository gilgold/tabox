// app/DuplicateSweepPanel.js
import React, { useState } from 'react';
import './DuplicateSweepPanel.css';

// One row per duplicated URL in the group: favicon + best title, with the real
// URL surfaced on hover (title attribute). Favicon/title come from the captured
// tab snapshot, falling back to the occurrence fields.
function tabRowsForGroup(group, rec) {
    const bestByUrl = new Map((rec && rec.bestTitlePerUrl ? rec.bestTitlePerUrl : []).map((b) => [b.normalizedUrl, b.title]));
    return (group.urls || []).map((u, i) => {
        const occ = (u.occurrences && u.occurrences[0]) || {};
        const tab = occ.tab || {};
        return {
            key: u.normalizedUrl || `row-${i}`,
            title: bestByUrl.get(u.normalizedUrl) || occ.title || tab.title || occ.url || tab.url || 'Untitled',
            url: occ.url || tab.url || u.normalizedUrl || '',
            favIconUrl: tab.favIconUrl || occ.favIconUrl || '',
        };
    });
}

// The active group's message, a reveal/hide list of the tabs in question, and
// the action buttons. Keyed by group id in the parent so showTabs resets when
// the active group changes.
function DuplicateGroupView({ group, rec, isWithin, nameOf, onAction }) {
    const [showTabs, setShowTabs] = useState(false);
    const rows = tabRowsForGroup(group, rec);

    return (
        <>
            <p className="dup-sweep-message">{rec.message}</p>

            <button
                type="button"
                className="dup-sweep-reveal"
                aria-expanded={showTabs}
                onClick={() => setShowTabs((s) => !s)}
            >
                {showTabs ? 'Hide' : 'Show'} {rows.length} tab{rows.length === 1 ? '' : 's'}
            </button>

            {showTabs && (
                <ul className="dup-tab-list">
                    {rows.map((r) => (
                        <li
                            key={r.key}
                            className="dup-tab-row"
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content={r.url}
                        >
                            {r.favIconUrl
                                ? <img className="dup-tab-favicon" src={r.favIconUrl} alt="" />
                                : <span className="dup-tab-favicon dup-tab-favicon--blank" aria-hidden="true" />}
                            <span className="dup-tab-title">{r.title}</span>
                        </li>
                    ))}
                </ul>
            )}

            {!isWithin && (
                <div className="dup-sweep-actions">
                    {group.collectionUids.map((uid) => (
                        <button
                            key={uid}
                            type="button"
                            className={`dup-pill dup-pill-keep${uid === rec.recommendedKeeperUid ? ' dup-pill-recommended' : ''}`}
                            onClick={() => onAction('keep-one', uid)}
                        >
                            Keep in {nameOf(uid)}
                        </button>
                    ))}
                    <button type="button" className="dup-pill dup-pill-extract" onClick={() => onAction('extract')}>
                        Extract to new collection
                    </button>
                    <button type="button" className="dup-pill dup-pill-discard" onClick={() => onAction('discard-all')}>
                        Discard from all collections
                    </button>
                </div>
            )}

            {isWithin && (
                <div className="dup-sweep-actions">
                    <button type="button" className="dup-pill dup-pill-keep dup-pill-recommended" onClick={() => onAction('dedupe-within')}>
                        Remove duplicates
                    </button>
                </div>
            )}
        </>
    );
}

// Renders one duplicate group at a time. The keeper is chosen by clicking a
// collection chip in the AI message (recommended chip pre-highlighted); other
// actions are Extract / Discard / Skip. Bottom bar carries undo + apply-to-all.
export function DuplicateSweepPanel({ sweep, namesByUid }) {
    const [applyToAll, setApplyToAll] = useState(false);
    const state = sweep.state;
    const groups = (state && state.groups) || [];
    const history = (state && state.history) || [];
    const active = groups.find((g) => g.status === 'pending');
    const pendingCount = groups.filter((g) => g.status === 'pending').length;
    const nameOf = (uid) => (namesByUid && namesByUid[uid]) || 'collection';

    const dispatch = (action, keeperUid) => {
        if (!active) return;
        sweep.apply({ groupId: active.id, action, keeperUid, applyToAll });
    };

    if (!groups.length) {
        return <div className="dup-sweep-empty">No duplicate tabs found.</div>;
    }

    if (!active) {
        return (
            <div className="dup-sweep">
                <div className="dup-sweep-done">All duplicates handled.</div>
                <div className="dup-sweep-bottom">
                    <button type="button" className="dup-sweep-undo" disabled={!history.length} onClick={() => sweep.undo()}>
                        Undo last action
                    </button>
                    <button type="button" className="dup-sweep-close" onClick={() => sweep.dismiss()}>Done</button>
                </div>
            </div>
        );
    }

    const rec = active.recommendation || {};

    return (
        <div className="dup-sweep">
            <div className="dup-sweep-progress">{pendingCount} duplicate group{pendingCount === 1 ? '' : 's'} left</div>

            <div className="dup-sweep-scroll">
                <DuplicateGroupView
                    key={active.id}
                    group={active}
                    rec={rec}
                    isWithin={active.kind === 'within'}
                    nameOf={nameOf}
                    onAction={dispatch}
                />
            </div>

            <div className="dup-sweep-bottom">
                <button type="button" className="dup-sweep-skip" onClick={() => dispatch('skip')}>
                    Keep everywhere / Skip
                </button>
                <label className="dup-sweep-applyall">
                    <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
                    Apply this action to all
                </label>
                <button type="button" className="dup-sweep-undo" disabled={!history.length} onClick={() => sweep.undo()}>
                    Undo last action
                </button>
            </div>
        </div>
    );
}
