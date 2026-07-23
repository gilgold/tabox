import React, { useState, useEffect } from 'react';
import Modal from 'react-modal';
import { MdClose } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { browser } from '../static/globals';
import { showSuccessToast } from './toastHelpers';
import './Modal.css';
import './AIEnableModal.css';

function AIEnableModal({ isOpen, onClose }) {
    const [status, setStatus] = useState('idle'); // idle | saving | error
    const [error, setError] = useState(null);

    // Reopening must not show a previous attempt's error.
    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setError(null);
        }
    }, [isOpen]);

    const busy = status === 'saving';

    const handleEnable = async () => {
        setError(null);
        setStatus('saving');
        // A failed write must not leave the modal stuck in a busy state.
        try {
            await browser.storage.local.set({ chkTaboxAI: true });
            showSuccessToast('Tabox AI is enabled!');
            setStatus('idle');
            onClose();
        } catch (saveError) {
            console.error('Tabox AI: could not save setting:', saveError);
            setError('Could not save the setting. Please try again.');
            setStatus('error');
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={busy ? undefined : onClose}
            contentLabel="Enable Tabox AI"
            className="modal-content ai-enable-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="ai-enable-modal-content">
                <div className="ai-enable-modal-header">
                    <div className="ai-enable-modal-title">
                        <BsStars className="ai-enable-title-icon" size={20} />
                        <span>Enable Tabox AI</span>
                    </div>
                    <button className="ai-enable-modal-close" onClick={onClose} type="button" disabled={busy} aria-label="Close">
                        <MdClose />
                    </button>
                </div>

                <div className="ai-enable-modal-body">
                    <p>
                        Tabox AI is powered by <strong>DeepSeek V4 Flash</strong>, a cloud AI model
                        accessed through OpenRouter. It names, organizes, and de-duplicates your
                        collections for you.
                    </p>

                    <div className="ai-enable-requirements">
                        <h4>Before enabling, please note:</h4>
                        <ul>
                            <li>When an AI tool runs, the titles and URLs of the tabs involved are sent to OpenRouter for processing. No page content or browsing history is ever sent.</li>
                            <li>AI features require an internet connection and being signed in to Tabox with your Google account.</li>
                        </ul>
                    </div>

                    {error && <div className="ai-enable-error">{error}</div>}
                </div>

                <div className="ai-enable-modal-footer">
                    <button type="button" className="ai-enable-btn ai-enable-btn-cancel" onClick={onClose} disabled={busy}>
                        Cancel
                    </button>
                    <button type="button" className="ai-enable-btn ai-enable-btn-primary" onClick={handleEnable} disabled={busy}>
                        {busy ? 'Enabling…' : 'Enable Tabox AI'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export default AIEnableModal;
