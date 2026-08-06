// app/DuplicateSweepPanel.js
import React, { useEffect, useState } from 'react';
import './DuplicateSweepPanel.css';

const CONFETTI_COLORS = ['#4361ee', '#22d3ee', '#2aa876', '#f6b73c', '#ef476f', '#9b5de5'];
const CONFETTI_PIECES = Array.from({ length: 24 }, (_, index) => ({
    id: index,
    left: `${4 + ((index * 37) % 92)}%`,
    delay: `${(index % 8) * 45}ms`,
    duration: `${1250 + (index % 5) * 110}ms`,
    drift: `${((index * 29) % 81) - 40}px`,
    rotation: `${180 + (index % 6) * 90}deg`,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
}));

function summarizeHistory(history) {
    const cleanedCollectionUids = new Set();
    let tabsRemoved = 0;
    let collectionsCreated = 0;
    let skipped = 0;

    history.forEach((entry) => {
        const removedTabs = Array.isArray(entry.removedTabs) ? entry.removedTabs : [];
        tabsRemoved += removedTabs.length;
        removedTabs.forEach((removed) => {
            if (removed.collectionUid) cleanedCollectionUids.add(removed.collectionUid);
        });
        if (entry.createdCollectionUid) collectionsCreated += 1;
        if (entry.action === 'skip') skipped += 1;
    });

    return { tabsRemoved, collectionsCreated, collectionsCleaned: cleanedCollectionUids.size, skipped };
}

function resultLabel(count, singular, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
}

function describeCleanupCounts(cleanup) {
    const parts = [];
    if (cleanup.collections.length) parts.push(`${cleanup.collections.length} ${resultLabel(cleanup.collections.length, 'collection')}`);
    if (cleanup.folders.length) parts.push(`${cleanup.folders.length} ${resultLabel(cleanup.folders.length, 'folder')}`);
    return parts.join(' and ');
}

// One selectable chip per empty collection/folder. Selected = will be removed.
function CleanupChip({ item, kind, selected, disabled, disabledTooltip, onToggle }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            className={`dup-sweep-cleanup-chip${selected ? ' dup-sweep-cleanup-chip--selected' : ''}${disabled ? ' dup-sweep-cleanup-chip--disabled' : ''}`}
            onClick={disabled ? undefined : () => onToggle(item.uid)}
            data-tooltip-id={disabled ? 'main-tooltip' : undefined}
            data-tooltip-class-name={disabled ? 'small-tooltip' : undefined}
            data-tooltip-content={disabledTooltip}
        >
            <span className="dup-sweep-cleanup-check" aria-hidden="true">{selected ? '✓' : ''}</span>
            {kind === 'folder' && <span className="dup-sweep-cleanup-kind">Folder</span>}
            <span className="dup-sweep-cleanup-chip-name">{item.name}</span>
        </button>
    );
}

// Lists collections the sweep emptied (and folders left holding only those) as
// selectable chips — everything selected by default — and deletes the selected
// ones. Deleting is a sweep history entry, so the Undo button restores everything.
function SweepCleanup({ sweep, historyLength }) {
    const [cleanup, setCleanup] = useState(null);
    // Tracks what the user turned OFF, so "everything selected" needs no state sync.
    const [deselected, setDeselected] = useState(() => new Set());
    const [removing, setRemoving] = useState(false);
    const [removedCount, setRemovedCount] = useState(0);
    const { cleanupPreview } = sweep;

    useEffect(() => {
        if (!cleanupPreview) return undefined;
        let alive = true;
        cleanupPreview().then((res) => {
            if (alive && res && res.ok) {
                setCleanup({ collections: res.collections || [], folders: res.folders || [] });
                setDeselected(new Set());
            }
        }).catch(() => {});
        return () => { alive = false; };
    }, [cleanupPreview, historyLength]);

    const hasItems = cleanup && (cleanup.collections.length > 0 || cleanup.folders.length > 0);
    if (!hasItems) {
        return removedCount > 0
            ? <p className="dup-sweep-cleanup-removed" role="status">{removedCount} empty {resultLabel(removedCount, 'item')} removed.</p>
            : null;
    }

    const toggle = (uid) => setDeselected((prev) => {
        const next = new Set(prev);
        if (next.has(uid)) next.delete(uid); else next.add(uid);
        return next;
    });

    const selectedCollections = cleanup.collections.filter((c) => !deselected.has(c.uid));
    // A folder only empties out if every one of its collections is removed too.
    const folderEligible = (f) => (f.collectionUids || []).every((uid) => !deselected.has(uid));
    const selectedFolders = cleanup.folders.filter((f) => !deselected.has(f.uid) && folderEligible(f));
    const selectedCount = selectedCollections.length + selectedFolders.length;

    const handleRemove = async () => {
        setRemoving(true);
        try {
            const res = await sweep.cleanup({
                collectionUids: selectedCollections.map((c) => c.uid),
                folderUids: selectedFolders.map((f) => f.uid),
            });
            if (res && res.ok) setRemovedCount((res.removedCollections || 0) + (res.removedFolders || 0));
        } finally {
            setRemoving(false);
        }
    };

    return (
        <section className="dup-sweep-cleanup" aria-label="Empty items left by the sweep">
            <p className="dup-sweep-cleanup-title">The sweep left {describeCleanupCounts(cleanup)} empty.</p>
            <p className="dup-sweep-cleanup-hint">Pick what to remove — unselect anything you want to keep:</p>
            <ul className="dup-sweep-cleanup-list" aria-label="Empty collections and folders">
                {cleanup.folders.map((f) => {
                    const eligible = folderEligible(f);
                    return (
                        <li key={f.uid}>
                            <CleanupChip
                                item={f}
                                kind="folder"
                                selected={eligible && !deselected.has(f.uid)}
                                disabled={!eligible}
                                disabledTooltip={eligible ? undefined : 'Kept because one of its collections is kept.'}
                                onToggle={toggle}
                            />
                        </li>
                    );
                })}
                {cleanup.collections.map((c) => (
                    <li key={c.uid}>
                        <CleanupChip item={c} kind="collection" selected={!deselected.has(c.uid)} onToggle={toggle} />
                    </li>
                ))}
            </ul>
            <button
                type="button"
                className="dup-sweep-cleanup-remove"
                disabled={removing || selectedCount === 0}
                onClick={handleRemove}
                data-tooltip-id="main-tooltip"
                data-tooltip-class-name="small-tooltip"
                data-tooltip-content="Delete the selected empty items. Undo restores them."
            >
                Remove selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
        </section>
    );
}

function SweepComplete({ sweep, history, onUndo, onDone }) {
    const stats = summarizeHistory(history);
    return (
        <div className="dup-sweep-done" role="status">
            <div className="dup-sweep-confetti" aria-hidden="true">
                {CONFETTI_PIECES.map((piece) => (
                    <span
                        key={piece.id}
                        className="dup-sweep-confetti-piece"
                        style={{
                            '--confetti-left': piece.left,
                            '--confetti-delay': piece.delay,
                            '--confetti-duration': piece.duration,
                            '--confetti-drift': piece.drift,
                            '--confetti-rotation': piece.rotation,
                            '--confetti-color': piece.color,
                        }}
                    />
                ))}
            </div>
            <div className="dup-sweep-done-content">
                <span className="dup-sweep-done-icon" aria-hidden="true">✓</span>
                <h3 className="dup-sweep-done-title">Sweep complete!</h3>
                <p className="dup-sweep-done-message">Your duplicate tabs have been cleaned up.</p>
                <ul className="dup-sweep-results" aria-label="Sweep results">
                    <li>
                        <strong aria-label={`${stats.tabsRemoved} ${resultLabel(stats.tabsRemoved, 'tab')} removed`}>{stats.tabsRemoved}</strong>
                        <span>{resultLabel(stats.tabsRemoved, 'tab removed', 'tabs removed')}</span>
                    </li>
                    <li>
                        <strong aria-label={`${stats.collectionsCreated} new ${resultLabel(stats.collectionsCreated, 'collection')} created`}>{stats.collectionsCreated}</strong>
                        <span>{resultLabel(stats.collectionsCreated, 'new collection', 'new collections')}</span>
                    </li>
                    <li>
                        <strong aria-label={`${stats.collectionsCleaned} ${resultLabel(stats.collectionsCleaned, 'collection')} cleaned`}>{stats.collectionsCleaned}</strong>
                        <span>{resultLabel(stats.collectionsCleaned, 'collection cleaned', 'collections cleaned')}</span>
                    </li>
                </ul>
                {stats.skipped > 0 && <span className="dup-sweep-skipped">{stats.skipped} skipped</span>}
                <SweepCleanup sweep={sweep} historyLength={history.length} />
            </div>
            <div className="dup-sweep-bottom dup-sweep-done-actions">
                <button type="button" className="dup-sweep-undo" disabled={!history.length} onClick={onUndo}>
                    Undo last action
                </button>
                <button type="button" className="dup-sweep-close" onClick={onDone}>Done</button>
            </div>
        </div>
    );
}

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

function CollectionName({ children }) {
    return (
        <span className="dup-sweep-collection-name">
            {children}
        </span>
    );
}

function DuplicateGroupSummary({ group, rows, nameOf }) {
    return (
        <section className="dup-sweep-summary" aria-label="Duplicate locations">
            <span className="dup-sweep-summary-label">Found in</span>
            <ul className="dup-sweep-collection-list" aria-label="Collections containing these tabs">
                {group.collectionUids.map((uid) => (
                    <li key={uid}>
                        <CollectionName>{nameOf(uid)}</CollectionName>
                    </li>
                ))}
            </ul>
            <p className="dup-sweep-summary-count">
                <strong>{rows.length}</strong> tab{rows.length === 1 ? '' : 's'} {rows.length === 1 ? 'has' : 'have'} duplicate copies.
            </p>
        </section>
    );
}

function ActionChoice({ action, selectedAction, icon, title, description, outcome, outcomeTooltip, recommended = false, destructive = false, onSelect }) {
    const selected = selectedAction === action;
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            className={`dup-sweep-choice${selected ? ' dup-sweep-choice--selected' : ''}${recommended ? ' dup-sweep-choice--has-badge' : ''}${destructive ? ' dup-sweep-choice--destructive' : ''}`}
            onClick={() => onSelect(action)}
        >
            <span className="dup-sweep-choice-radio" aria-hidden="true" />
            <span className={`dup-sweep-choice-icon dup-sweep-choice-icon--${action}`} aria-hidden="true">{icon}</span>
            <span className="dup-sweep-choice-copy">
                <strong className="dup-sweep-choice-title">{title}</strong>
                <span className="dup-sweep-choice-description">{description}</span>
            </span>
            {recommended && <span className="dup-sweep-choice-badge">Recommended</span>}
            <span
                className="dup-sweep-choice-outcome"
                data-tooltip-id={outcomeTooltip ? 'main-tooltip' : undefined}
                data-tooltip-class-name={outcomeTooltip ? 'small-tooltip' : undefined}
                data-tooltip-content={outcomeTooltip}
            >
                {outcome}
            </span>
        </button>
    );
}

function DuplicateGroupView({ group, rec, isWithin, nameOf, selectedAction, onSelectAction }) {
    const [showTabs, setShowTabs] = useState(false);
    const rows = tabRowsForGroup(group, rec);
    const keeperUid = group.collectionUids.includes(rec.recommendedKeeperUid)
        ? rec.recommendedKeeperUid
        : group.collectionUids[0];
    const otherNames = group.collectionUids.filter((uid) => uid !== keeperUid).map(nameOf);
    const [firstOtherName, ...additionalOtherNames] = otherNames;
    const removeOutcomeTooltip = `Remove duplicates from ${otherNames.join(', ')}`;
    const suggestedName = rec.suggestedNewCollectionName || 'Shared Tabs';
    const tabListId = `dup-tab-preview-${group.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    return (
        <>
            <DuplicateGroupSummary group={group} rows={rows} nameOf={nameOf} />

            <h3 className="dup-sweep-question">What should happen?</h3>

            <div className="dup-sweep-choice-list" role="radiogroup" aria-label="Duplicate tab action">
                {isWithin ? (
                    <>
                        <ActionChoice
                            action="dedupe-within"
                            selectedAction={selectedAction}
                            icon="✓"
                            title="Remove duplicate copies"
                            description={`Keep one copy of each tab in ${nameOf(keeperUid)}`}
                            outcome="Remove only the extras"
                            recommended
                            onSelect={onSelectAction}
                        />
                        <ActionChoice
                            action="skip"
                            selectedAction={selectedAction}
                            icon="="
                            title="Keep every copy"
                            description="Leave this collection unchanged"
                            outcome="Skip this duplicate group"
                            onSelect={onSelectAction}
                        />
                    </>
                ) : (
                    <>
                        <ActionChoice
                            action="keep-one"
                            selectedAction={selectedAction}
                            icon="✓"
                            title="Keep one copy"
                            description={`Keep these tabs in ${nameOf(keeperUid)}`}
                            outcome={(
                                <>
                                    <span className="dup-sweep-outcome-prefix">Remove duplicates from{' '}</span>
                                    <span className="dup-sweep-outcome-name">{firstOtherName}</span>
                                    {additionalOtherNames.length > 0 && (
                                        <span className="dup-sweep-outcome-more">{' '}+{additionalOtherNames.length} more</span>
                                    )}
                                </>
                            )}
                            outcomeTooltip={removeOutcomeTooltip}
                            recommended
                            onSelect={onSelectAction}
                        />
                        <ActionChoice
                            action="extract"
                            selectedAction={selectedAction}
                            icon="+"
                            title="Move to a new collection"
                            description={<>Suggested name: <strong>{suggestedName}</strong></>}
                            outcome="Remove duplicates from current collections"
                            onSelect={onSelectAction}
                        />
                        <ActionChoice
                            action="skip"
                            selectedAction={selectedAction}
                            icon="="
                            title="Keep every copy"
                            description="Leave all collections unchanged"
                            outcome="Skip this duplicate group"
                            onSelect={onSelectAction}
                        />
                        <ActionChoice
                            action="discard-all"
                            selectedAction={selectedAction}
                            icon="×"
                            title="Remove every copy"
                            description="Delete these tabs from all collections"
                            outcome="Remove every saved copy"
                            destructive
                            onSelect={onSelectAction}
                        />
                    </>
                )}
            </div>

            <div className={`dup-tab-preview${showTabs ? ' dup-tab-preview--expanded' : ''}`}>
                <button
                    type="button"
                    className="dup-sweep-reveal"
                    aria-expanded={showTabs}
                    aria-controls={tabListId}
                    onClick={() => setShowTabs((s) => !s)}
                >
                    <span aria-hidden="true">{showTabs ? '⌄' : '›'}</span>
                    {showTabs ? 'Hide' : 'Preview'} the {rows.length} affected tab{rows.length === 1 ? '' : 's'}
                </button>

                {showTabs && (
                    <ul id={tabListId} className="dup-tab-list" aria-label="Affected tabs">
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
            </div>
        </>
    );
}

// Renders one duplicate group at a time. The recommended action starts selected;
// the user reviews an outcome, then confirms it from the pinned bottom bar.
export function DuplicateSweepPanel({ sweep, namesByUid }) {
    const [applyToAll, setApplyToAll] = useState(false);
    const [selection, setSelection] = useState(null);
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
                <SweepComplete sweep={sweep} history={history} onUndo={() => sweep.undo()} onDone={() => sweep.dismiss()} />
            </div>
        );
    }

    const rec = active.recommendation || {};
    const total = groups.length;
    const resolvedCount = total - pendingCount;
    const defaultAction = active.kind === 'within' ? 'dedupe-within' : 'keep-one';
    const selectedAction = selection && selection.groupId === active.id ? selection.action : defaultAction;
    const keeperUid = active.collectionUids.includes(rec.recommendedKeeperUid)
        ? rec.recommendedKeeperUid
        : active.collectionUids[0];

    return (
        <div className="dup-sweep">
            <div className="dup-sweep-progress">
                <div className="dup-sweep-progress-top">
                    <span className="dup-sweep-step">{resolvedCount + 1} of {total} duplicate groups</span>
                    <button
                        type="button"
                        className="dup-sweep-finish"
                        onClick={() => sweep.dismiss()}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-class-name="dup-action-tip"
                        data-tooltip-content={'Apply the choices you’ve made so far\nand end the sweep here.'}
                    >
                        End sweep
                    </button>
                </div>
                <div
                    className="dup-sweep-progress-bar"
                    role="progressbar"
                    aria-label="Duplicate sweep progress"
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={resolvedCount}
                >
                    <div className="dup-sweep-progress-fill" style={{ width: `${(resolvedCount / total) * 100}%` }} />
                </div>
            </div>

            <div className="dup-sweep-scroll">
                <DuplicateGroupView
                    key={active.id}
                    group={active}
                    rec={rec}
                    isWithin={active.kind === 'within'}
                    nameOf={nameOf}
                    selectedAction={selectedAction}
                    onSelectAction={(action) => setSelection({ groupId: active.id, action })}
                />
            </div>

            <div className="dup-sweep-bottom">
                <label className="dup-sweep-applyall">
                    <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
                    Use this choice for all remaining groups
                </label>
                <button type="button" className="dup-sweep-undo" aria-label="Undo last action" disabled={!history.length} onClick={() => sweep.undo()}>
                    Undo
                </button>
                <button
                    type="button"
                    className="dup-sweep-apply"
                    onClick={() => dispatch(selectedAction, selectedAction === 'keep-one' ? keeperUid : undefined)}
                >
                    Apply choice
                </button>
            </div>
        </div>
    );
}
