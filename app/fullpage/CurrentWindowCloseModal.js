import React, { Activity, useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import { MdClose, MdWarning } from 'react-icons/md';
import { getColorValue } from '../utils/colorMigration';
import { saveCollectionSnapshot } from '../utils/saveCollectionSnapshot';
import { browser } from '../../static/globals';
import { showErrorToast, showSuccessToast } from '../toastHelpers';
import './CurrentWindowCloseModal.css';

function CurrentWindowCloseModal({
    isOpen,
    onClose,
    windowSnapshot,
    folders,
    addCollection,
    onDataUpdate,
    onSaved,
    onWindowClosed,
}) {
    const [name, setName] = useState('');
    const [selectedFolder, setSelectedFolder] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setName(windowSnapshot?.name || 'Current Window');
        setSelectedFolder('');
        setIsSubmitting(false);

        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 100);
    }, [isOpen, windowSnapshot]);

    const closeWindow = async ({ saveFirst }) => {
        if (!windowSnapshot?.windowId) {
            return;
        }

        setIsSubmitting(true);
        let savedCollection = null;

        try {
            if (saveFirst) {
                savedCollection = await saveCollectionSnapshot({
                    snapshot: windowSnapshot,
                    name: name.trim(),
                    parentId: selectedFolder,
                    addCollection,
                    onDataUpdate,
                    onSaved,
                });
            }

            await browser.windows.remove(windowSnapshot.windowId);

            if (savedCollection) {
                showSuccessToast(`"${savedCollection.name}" saved and window closed`);
            } else {
                showSuccessToast('Window closed');
            }

            onClose();

            if (onWindowClosed) {
                await onWindowClosed(windowSnapshot.windowId);
            }
        } catch (error) {
            if (savedCollection) {
                showErrorToast(`Window saved, but closing failed: ${error.message}`);
            } else {
                showErrorToast(`Failed to close window: ${error.message}`);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveAndClose = async () => {
        if (!name.trim()) {
            return;
        }

        await closeWindow({ saveFirst: true });
    };

    const handleCloseWithoutSaving = async () => {
        await closeWindow({ saveFirst: false });
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Close Current Window"
            className="current-window-close-modal"
            overlayClassName="current-window-close-modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="current-window-close-modal-content">
                    <div className="current-window-close-modal-header">
                        <div className="current-window-close-modal-title">
                            <MdWarning size={20} />
                            <span>Close Window</span>
                        </div>
                        <button className="current-window-close-modal-close" type="button" onClick={onClose}>
                            <MdClose />
                        </button>
                    </div>

                    <div className="current-window-close-modal-body">
                        <p className="current-window-close-copy">
                            Close <strong>{windowSnapshot?.name || 'this window'}</strong>? You can save it as a collection first.
                        </p>

                        <div className="current-window-close-form-group">
                            <label htmlFor="current-window-close-name">Collection Name</label>
                            <input
                                ref={inputRef}
                                id="current-window-close-name"
                                type="text"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="Enter a collection name..."
                                disabled={isSubmitting}
                            />
                        </div>

                        {folders?.length > 0 && (
                            <div className="current-window-close-form-group">
                                <label htmlFor="current-window-close-folder">Save To</label>
                                <div className="current-window-close-folder-select-wrapper">
                                    <select
                                        id="current-window-close-folder"
                                        value={selectedFolder}
                                        onChange={(event) => setSelectedFolder(event.target.value)}
                                        disabled={isSubmitting}
                                    >
                                        <option value="">Root level (no folder)</option>
                                        {folders.map((folder) => (
                                            <option key={folder.uid} value={folder.uid}>
                                                {folder.name}
                                            </option>
                                        ))}
                                    </select>
                                    {selectedFolder && (
                                        <span
                                            className="current-window-close-folder-dot"
                                            style={{
                                                backgroundColor: (() => {
                                                    const folder = folders.find((entry) => entry.uid === selectedFolder);
                                                    return folder?.color && folder.color !== 'default'
                                                        ? getColorValue(folder.color)
                                                        : 'var(--primary-color)';
                                                })(),
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="current-window-close-modal-footer">
                        <button
                            type="button"
                            className="current-window-close-btn current-window-close-btn-cancel"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="current-window-close-btn current-window-close-btn-secondary"
                            onClick={handleCloseWithoutSaving}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Closing...' : 'Close Without Saving'}
                        </button>
                        <button
                            type="button"
                            className="current-window-close-btn current-window-close-btn-primary"
                            onClick={handleSaveAndClose}
                            disabled={!name.trim() || isSubmitting}
                        >
                            <span>{isSubmitting ? 'Saving...' : 'Save & Close'}</span>
                        </button>
                    </div>
                </div>
            </Activity>
        </Modal>
    );
}

export default CurrentWindowCloseModal;
