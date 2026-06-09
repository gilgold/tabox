import React from 'react';
import { MdSettingsBackupRestore } from 'react-icons/md';
import './OrphanRecoveryModal.css';

/**
 * Consent-first modal shown when recoverable orphaned collections are detected.
 * Presentational only — all state lives in the parent via useOrphanRecovery.
 */
function OrphanRecoveryModal({ isOpen, orphans = [], busy = false, onRestoreAll, onChoose, onDismiss }) {
    if (!isOpen) return null;

    const count = orphans.length;
    const label = count === 1 ? 'collection' : 'collections';

    return (
        <div className="orphan-recovery-overlay" role="dialog" aria-modal="true" aria-label="Recover hidden collections">
            <div className="orphan-recovery-modal">
                <h3><MdSettingsBackupRestore size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />We found collections we can restore</h3>
                <p>
                    An earlier update accidentally hid <strong>{count} {label}</strong>. They&apos;re still safe on your
                    device — want them back?
                </p>
                <div className="orphan-recovery-actions">
                    <button type="button" className="primary" onClick={onRestoreAll} disabled={busy}>
                        {busy ? 'Restoring…' : `Restore all ${count}`}
                    </button>
                    <button type="button" className="secondary" onClick={onChoose} disabled={busy}>
                        Choose what to restore
                    </button>
                    <button type="button" className="tertiary" onClick={onDismiss} disabled={busy}>
                        Not now
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OrphanRecoveryModal;
