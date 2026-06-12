import React, { useState, useEffect } from 'react';
import Modal from 'react-modal';
import { MdClose } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { browser } from '../static/globals';
import { getAIAvailability, downloadModel } from './ai/aiClient';
import { showSuccessToast } from './toastHelpers';
import './Modal.css';
import './AIEnableModal.css';

function AIEnableModal({ isOpen, onClose }) {
    const [status, setStatus] = useState('idle'); // idle | checking | downloading | error
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);

    // Fix 5: reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setError(null);
            setProgress(0);
        }
    }, [isOpen]);

    const busy = status === 'checking' || status === 'downloading';

    const handleEnable = async () => {
        setError(null);
        setStatus('checking');
        const availability = await getAIAvailability();

        if (availability === 'unsupported') {
            setError('Tabox AI requires Chrome 138 or newer.');
            setStatus('error');
            return;
        }
        if (availability === 'unavailable') {
            setError('This device does not meet the requirements for on-device AI.');
            setStatus('error');
            return;
        }
        if (availability !== 'available') {
            setStatus('downloading');
            setProgress(0); // Fix 4: reset stale progress on retry
            try {
                await downloadModel(setProgress);
            } catch (downloadError) {
                console.error('Tabox AI model download failed:', downloadError);
                setError('The AI model download failed. Please try again.');
                setStatus('error');
                return;
            }
        }

        // Fix 2: wrap storage set + toast + close in try/catch
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
                        Tabox AI runs entirely on your device using Chrome&apos;s built-in AI model (Gemini Nano).
                        Your tabs and collections <strong>never leave your computer</strong>.
                    </p>

                    <div className="ai-enable-requirements">
                        <h4>Before enabling, please note:</h4>
                        <ul>
                            <li>Requires Chrome 138 or newer on Windows 10/11, macOS 13+, Linux, or ChromeOS.</li>
                            <li>Requires at least 22 GB of free disk space on the drive with your Chrome profile.</li>
                            <li>Requires a GPU with more than 4 GB of VRAM, or 16 GB of RAM with a 4-core CPU.</li>
                            <li>Chrome will download the AI model (a few GB) the first time you enable this. This can take a while on slow connections.</li>
                        </ul>
                    </div>

                    {status === 'downloading' && (
                        <div className="ai-enable-progress">
                            <div className="ai-enable-progress-track">
                                <div className="ai-enable-progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <span className="ai-enable-progress-label">Downloading AI model… {progress}%</span>
                        </div>
                    )}

                    {error && <div className="ai-enable-error">{error}</div>}
                </div>

                <div className="ai-enable-modal-footer">
                    <button type="button" className="ai-enable-btn ai-enable-btn-cancel" onClick={onClose} disabled={busy}>
                        Cancel
                    </button>
                    <button type="button" className="ai-enable-btn ai-enable-btn-primary" onClick={handleEnable} disabled={busy}>
                        {status === 'checking' ? 'Checking device…'
                            : status === 'downloading' ? 'Downloading…'
                                : 'Enable Tabox AI'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export default AIEnableModal;
