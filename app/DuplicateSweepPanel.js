// app/DuplicateSweepPanel.js
import React, { useState } from 'react';
import './DuplicateSweepPanel.css';

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
    const isWithin = active.kind === 'within';

    return (
        <div className="dup-sweep">
            <div className="dup-sweep-progress">{pendingCount} duplicate group{pendingCount === 1 ? '' : 's'} left</div>
            <p className="dup-sweep-message">{rec.message}</p>

            {!isWithin && (
                <div className="dup-sweep-actions">
                    {active.collectionUids.map((uid) => (
                        <button
                            key={uid}
                            type="button"
                            className={`dup-pill dup-pill-keep${uid === rec.recommendedKeeperUid ? ' dup-pill-recommended' : ''}`}
                            onClick={() => dispatch('keep-one', uid)}
                        >
                            Keep in {nameOf(uid)}
                        </button>
                    ))}
                    <button type="button" className="dup-pill dup-pill-extract" onClick={() => dispatch('extract')}>
                        Extract to new collection
                    </button>
                    <button type="button" className="dup-pill dup-pill-discard" onClick={() => dispatch('discard-all')}>
                        Discard from all collections
                    </button>
                </div>
            )}

            {isWithin && (
                <div className="dup-sweep-actions">
                    <button type="button" className="dup-pill dup-pill-keep dup-pill-recommended" onClick={() => dispatch('dedupe-within')}>
                        Remove duplicates
                    </button>
                </div>
            )}

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
