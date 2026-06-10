import React, { useState } from 'react';
import { MdSettingsBackupRestore } from 'react-icons/md';
import './OrphanRecoveryModal.css';

/**
 * Consent-first modal shown when recoverable orphaned collections are detected.
 * Two modes: a prompt ("Restore all" / "Choose what to restore" / "Not now") and
 * a self-contained selective checklist. Restore state (busy) lives in the parent
 * via useOrphanRecovery; the picker selection is local to the modal.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {Array<{uid:string,name:string,tabCount:number}>} props.orphans
 * @param {boolean} props.busy
 * @param {() => void} props.onRestoreAll - restore every detected orphan
 * @param {(uids: string[]) => void} props.onRestoreSelected - restore a chosen subset
 * @param {() => void} props.onDismiss - close and suppress the modal (entry stays in Settings)
 */
function OrphanRecoveryModal({ isOpen, orphans = [], busy = false, onRestoreAll, onRestoreSelected, onDismiss }) {
    const [mode, setMode] = useState('prompt');
    const [selectedIds, setSelectedIds] = useState([]);

    if (!isOpen) return null;

    const count = orphans.length;
    const label = count === 1 ? 'collection' : 'collections';

    const enterChooseMode = () => {
        setSelectedIds(orphans.map((o) => o.uid)); // default: everything selected
        setMode('choose');
    };

    const toggle = (uid) => setSelectedIds((previous) => (
        previous.includes(uid) ? previous.filter((id) => id !== uid) : [...previous, uid]
    ));

    return (
        <div className="orphan-recovery-overlay">
            <div className="orphan-recovery-modal" role="dialog" aria-modal="true" aria-label="Recover hidden collections">
                {mode === 'prompt' ? (
                    <>
                        <h3><MdSettingsBackupRestore size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />We found collections we can restore</h3>
                        <p>
                            An earlier update accidentally hid <strong>{count} {label}</strong>. They&apos;re still safe on your
                            device — want them back?
                        </p>
                        <div className="orphan-recovery-actions">
                            <button type="button" className="primary" onClick={onRestoreAll} disabled={busy}>
                                {busy ? 'Restoring…' : `Restore all ${count}`}
                            </button>
                            <button type="button" className="secondary" onClick={enterChooseMode} disabled={busy}>
                                Choose what to restore
                            </button>
                            <button type="button" className="tertiary" onClick={onDismiss} disabled={busy}>
                                Not now
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h3><MdSettingsBackupRestore size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Choose collections to restore</h3>
                        <ul className="orphan-recovery-list">
                            {orphans.map((orphan) => (
                                <li key={orphan.uid} className="orphan-recovery-list-item">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(orphan.uid)}
                                            onChange={() => toggle(orphan.uid)}
                                            disabled={busy}
                                        />
                                        <span className="orphan-recovery-list-name">{orphan.name}</span>
                                        <span className="orphan-recovery-list-meta">
                                            {orphan.tabCount} {orphan.tabCount === 1 ? 'tab' : 'tabs'}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <div className="orphan-recovery-actions">
                            <button
                                type="button"
                                className="primary"
                                onClick={() => onRestoreSelected(selectedIds)}
                                disabled={busy || selectedIds.length === 0}
                            >
                                {busy ? 'Restoring…' : `Restore ${selectedIds.length} selected`}
                            </button>
                            <button type="button" className="tertiary" onClick={() => setMode('prompt')} disabled={busy}>
                                Back
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default OrphanRecoveryModal;
