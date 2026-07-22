import React, { useState } from 'react';
import Modal from 'react-modal';
import { MdClose } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { useAtom } from 'jotai';
import { nonChromeProConfirmState } from './atoms/premiumState';
import { getBrowserName } from './ai/browserSupport';
import './Modal.css';
import './NonChromeProConfirmModal.css';

// Pre-checkout confirmation shown on non-Chrome browsers: Tabox AI is
// Chrome-only, so the user must acknowledge that before paying for Pro.
// A single instance is rendered by App.js (popup and full-page) and driven
// by nonChromeProConfirmState; useProCheckout opens it.
export default function NonChromeProConfirmModal() {
    const [state, setState] = useAtom(nonChromeProConfirmState);
    const [busy, setBusy] = useState(false);

    if (!state) return null;
    const close = () => !busy && setState(null);

    const body = `Tabox AI is only available on Google Chrome — it won't work in ${getBrowserName()}. `
        + 'Everything else in Tabox Pro, like shared folders and share links, works here. '
        + 'Do you want to continue to checkout?';

    const handleConfirm = async () => {
        setBusy(true);
        try {
            if (state.onConfirm) await state.onConfirm();
            setState(null);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen
            onRequestClose={close}
            contentLabel="Tabox AI is Chrome-only"
            className="modal-content non-chrome-pro-confirm-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
        >
            <div className="non-chrome-pro-confirm-header">
                <BsStars size={20} />
                <h3>Before you upgrade</h3>
                <button className="non-chrome-pro-confirm-close" onClick={close} type="button" aria-label="Close" disabled={busy}>
                    <MdClose size={18} />
                </button>
            </div>
            <p>{body}</p>
            <div className="non-chrome-pro-confirm-actions">
                <button className="non-chrome-pro-confirm-cancel" onClick={close} type="button" disabled={busy}>
                    Cancel
                </button>
                <button className="non-chrome-pro-confirm-continue" onClick={handleConfirm} type="button" disabled={busy}>
                    {busy ? 'Opening…' : 'Continue to checkout'}
                </button>
            </div>
        </Modal>
    );
}
