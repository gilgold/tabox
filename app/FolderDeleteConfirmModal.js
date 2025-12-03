import React, { useState, useEffect, Activity } from 'react';
import Modal from 'react-modal';
import { MdWarning, MdClose } from 'react-icons/md';
import './Modal.css';
import { browser } from '../static/globals';

const STORAGE_KEY = 'folderDeleteWithCollections';

function FolderDeleteConfirmModal({ 
    isOpen, 
    onClose, 
    onConfirm, 
    folderName, 
    collectionCount 
}) {
    const [deleteCollections, setDeleteCollections] = useState(false);

    // Load saved preference from local storage when modal opens
    useEffect(() => {
        if (isOpen && browser && browser.storage && browser.storage.local) {
            browser.storage.local.get(STORAGE_KEY).then((result) => {
                if (result[STORAGE_KEY] !== undefined) {
                    setDeleteCollections(result[STORAGE_KEY]);
                }
            }).catch((error) => {
                console.error('Error loading folder delete preference:', error);
            });
        }
    }, [isOpen]);

    // Save preference to local storage when changed
    const handleCheckboxChange = (checked) => {
        setDeleteCollections(checked);
        
        if (browser && browser.storage && browser.storage.local) {
            const storageObj = {};
            storageObj[STORAGE_KEY] = checked;
            
            browser.storage.local.set(storageObj).catch((error) => {
                console.error('Error saving folder delete preference:', error);
            });
        }
    };

    const handleConfirm = () => {
        onConfirm(deleteCollections);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Delete Folder Confirmation"
            className="modal-content delete-confirm-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="delete-confirm-modal-content">
                {/* Header */}
                <div className="delete-confirm-modal-header">
                    <div className="delete-confirm-modal-title">
                        <MdWarning 
                            style={{ 
                                color: '#DC2626', 
                                fontSize: '20px', 
                                marginRight: '8px' 
                            }} 
                        />
                        <span>Delete Folder</span>
                    </div>
                    <button 
                        className="delete-confirm-modal-close"
                        onClick={onClose}
                        type="button"
                    >
                        <MdClose />
                    </button>
                </div>

                {/* Body */}
                <div className="delete-confirm-modal-body">
                    <p className="delete-confirm-question">
                        Are you sure you want to delete the folder <strong>"{folderName}"</strong>?
                    </p>
                    
                    <div className="delete-confirm-warning-box">
                        <p>
                            ⚠️ This folder contains <strong>{collectionCount} collection{collectionCount !== 1 ? 's' : ''}</strong>.
                        </p>
                        <p>
                            {deleteCollections ? (
                                <>Deleting this folder will <strong style={{ color: '#DC2626' }}>also delete all collections</strong> inside it.</>
                            ) : (
                                <>Deleting this folder will <strong>move all collections to the root level</strong> (they won't be deleted).</>
                            )}
                        </p>
                    </div>

                    {/* Checkbox for delete collections option */}
                    <div className="delete-confirm-checkbox-container">
                        <label className="delete-confirm-checkbox-label">
                            <input
                                type="checkbox"
                                checked={deleteCollections === true}
                                onChange={(e) => handleCheckboxChange(e.target.checked)}
                                className="delete-confirm-checkbox"
                            />
                            <span className={`delete-confirm-checkbox-text ${deleteCollections ? 'delete-mode' : ''}`}>
                                Also delete all collections inside this folder
                            </span>
                        </label>
                    </div>
                </div>

                {/* Footer */}
                <div className="delete-confirm-modal-footer">
                    <button
                        type="button"
                        className="delete-confirm-btn delete-confirm-btn-cancel"
                        onClick={onClose}
                        onKeyDown={handleKeyDown}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="delete-confirm-btn delete-confirm-btn-danger"
                        onClick={handleConfirm}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        style={{ 
                            backgroundColor: deleteCollections ? '#B91C1C' : '#DC2626',
                            transition: 'background-color 0.2s ease'
                        }}
                    >
                        {deleteCollections ? 'Delete Folder & Collections' : 'Delete Folder'}
                    </button>
                </div>

                {/* Keyboard Hint */}
                <div className="delete-confirm-keyboard-hint">
                    Press <kbd>Enter</kbd> to delete or <kbd>Esc</kbd> to cancel
                </div>
            </div>
            </Activity>
        </Modal>
    );
}

export default FolderDeleteConfirmModal; 