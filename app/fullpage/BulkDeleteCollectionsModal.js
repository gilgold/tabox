import React, { Activity } from 'react';
import Modal from 'react-modal';
import { MdClose, MdDelete, MdWarning } from 'react-icons/md';
import '../Modal.css';

function BulkDeleteCollectionsModal({
    isOpen,
    onClose,
    onConfirm,
    selectedCount = 0,
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
            contentLabel="Delete Collections Confirmation"
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
                            <span>Delete Collections</span>
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
                            Delete <strong>{selectedCount}</strong> selected collection{selectedCount !== 1 ? 's' : ''}?
                        </p>

                        <div className="delete-confirm-warning-box">
                            <p>
                                <MdDelete size={16} style={{ verticalAlign: 'text-bottom', marginRight: '6px' }} />
                                This permanently removes the selected collections from Tabox.
                            </p>
                            <p>
                                This bulk delete does not have an undo step.
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
                            Delete Collections
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

export default BulkDeleteCollectionsModal;
