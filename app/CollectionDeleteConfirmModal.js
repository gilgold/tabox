import React, { Activity } from 'react';
import Modal from 'react-modal';
import { MdClose, MdDelete, MdWarning } from 'react-icons/md';
import './Modal.css';

function CollectionDeleteConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    collectionName,
}) {
    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            onConfirm?.();
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Delete Collection Confirmation"
            className="modal-content delete-confirm-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="delete-confirm-modal-content">
                    <div className="delete-confirm-modal-header">
                        <div className="delete-confirm-modal-title">
                            <MdWarning
                                style={{
                                    color: '#DC2626',
                                    fontSize: '20px',
                                    marginRight: '8px',
                                }}
                            />
                            <span>Delete Collection</span>
                        </div>
                        <button
                            className="delete-confirm-modal-close"
                            onClick={onClose}
                            type="button"
                        >
                            <MdClose />
                        </button>
                    </div>

                    <div className="delete-confirm-modal-body">
                        <p className="delete-confirm-question">
                            Are you sure you want to delete <strong>"{collectionName}"</strong>?
                        </p>

                        <div className="delete-confirm-warning-box">
                            <p>
                                <MdDelete size={16} style={{ verticalAlign: 'text-bottom', marginRight: '6px' }} />
                                This permanently removes this collection from Tabox.
                            </p>
                            <p>
                                This action cannot be undone from this dialog.
                            </p>
                        </div>
                    </div>

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
                            onClick={onConfirm}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        >
                            Delete Collection
                        </button>
                    </div>

                    <div className="delete-confirm-keyboard-hint">
                        Press <kbd>Enter</kbd> to delete or <kbd>Esc</kbd> to cancel
                    </div>
                </div>
            </Activity>
        </Modal>
    );
}

export default CollectionDeleteConfirmModal;
