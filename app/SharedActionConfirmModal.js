import React, { useState } from 'react';
import Modal from 'react-modal';
import { useAtom } from 'jotai';
import { MdWarningAmber, MdClose } from 'react-icons/md';
import { sharedActionConfirmState } from './atoms/sharedFoldersState';
import { leaveSharedFolder, unshareSharedFolder } from './utils/sharedFolderActions';
import './Modal.css';
import './SharedActionConfirmModal.css';

const COPY = {
    unshare: {
        title: 'Stop sharing?',
        body: (name) => `Stop sharing "${name}"? All members will lose access. Your local copy is kept.`,
        confirmLabel: 'Stop Sharing',
    },
    leave: {
        title: 'Leave shared folder?',
        body: (name) => `Leave "${name}"? You'll keep a local copy but stop receiving updates.`,
        confirmLabel: 'Leave',
    },
};

/**
 * Confirmation gate for the two destructive/irreversible-feeling shared-folder
 * actions: "Stop Sharing (keep my copy)" (owner-only, revokes every member's
 * access) and "Leave Shared Folder" (member-only, stops receiving updates).
 * A single instance is rendered by App.js (both popup and full-page branches)
 * and driven by the `sharedActionConfirmState` atom — every menu entry point
 * (FolderContainer, FPSidebar, FPContentArea) opens this SAME modal instead of
 * firing the action directly on click.
 *
 * @param {object} props
 * @param {Function} [props.onConfirmed] - Called after a successful confirm to refresh data.
 */
export default function SharedActionConfirmModal({ onConfirmed }) {
    const [state, setState] = useAtom(sharedActionConfirmState);
    const [busy, setBusy] = useState(false);

    if (!state) return null;
    const { kind, folder } = state;
    const copy = COPY[kind];
    if (!copy || !folder) return null;

    const close = () => !busy && setState(null);

    const handleConfirm = async () => {
        setBusy(true);
        try {
            const action = kind === 'unshare' ? unshareSharedFolder : leaveSharedFolder;
            const ok = await action(folder, onConfirmed);
            if (ok) setState(null);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen
            onRequestClose={close}
            contentLabel={copy.title}
            className="modal-content shared-action-confirm-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
        >
            <div className="shared-action-confirm-header">
                <MdWarningAmber size={22} />
                <h3>{copy.title}</h3>
                <button className="shared-action-confirm-close" onClick={close} type="button" aria-label="Close" disabled={busy}>
                    <MdClose size={18} />
                </button>
            </div>
            <p>{copy.body(folder.name)}</p>
            <div className="shared-action-confirm-actions">
                <button className="shared-action-confirm-cancel" onClick={close} type="button" disabled={busy}>
                    Cancel
                </button>
                <button className="shared-action-confirm-danger" onClick={handleConfirm} type="button" disabled={busy}>
                    {busy ? 'Working…' : copy.confirmLabel}
                </button>
            </div>
        </Modal>
    );
}
