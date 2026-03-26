import React, { useEffect, useMemo, useRef, useState, Activity } from 'react';
import Modal from 'react-modal';
import { MdClose, MdDriveFileMoveOutline, MdFolder } from 'react-icons/md';
import { getColorValue } from '../utils/colorMigration';
import '../Modal.css';

function BulkMoveCollectionsModal({
    isOpen,
    onClose,
    onConfirm,
    folders = [],
    selectedCount = 0,
}) {
    const [selectedFolderId, setSelectedFolderId] = useState('');
    const inputRef = useRef(null);
    const hasFolders = folders.length > 0;

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setSelectedFolderId(folders[0]?.uid || '');
        setTimeout(() => {
            inputRef.current?.focus();
        }, 100);
    }, [folders, isOpen]);

    const selectedFolder = useMemo(
        () => folders.find((folder) => folder.uid === selectedFolderId) || null,
        [folders, selectedFolderId],
    );

    const handleConfirm = () => {
        if (!selectedFolderId) {
            return;
        }

        onConfirm?.(selectedFolderId);
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleConfirm();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose?.();
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Move Collections to Folder"
            className="bulk-collection-modal"
            overlayClassName="create-folder-modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="bulk-collection-modal-content">
                    <div className="bulk-collection-modal-header">
                        <div className="bulk-collection-modal-title">
                            <MdDriveFileMoveOutline
                                style={{
                                    color: 'var(--primary-color)',
                                    fontSize: '20px',
                                    marginRight: '8px',
                                }}
                            />
                            <span>Move Collections</span>
                        </div>
                        <button
                            className="bulk-collection-modal-close"
                            onClick={onClose}
                            type="button"
                        >
                            <MdClose />
                        </button>
                    </div>

                    <div className="bulk-collection-modal-body">
                        <p className="bulk-collection-modal-copy">
                            Move <strong>{selectedCount}</strong> selected collection{selectedCount !== 1 ? 's' : ''} into an existing folder.
                        </p>

                        <div className="bulk-collection-form-group">
                            <label htmlFor="bulk-move-folder-select" className="bulk-collection-label">
                                Destination Folder
                            </label>
                            <div className="bulk-collection-select-wrapper">
                                <select
                                    ref={inputRef}
                                    id="bulk-move-folder-select"
                                    className="bulk-collection-select"
                                    value={selectedFolderId}
                                    onChange={(event) => setSelectedFolderId(event.target.value)}
                                    onKeyDown={handleKeyDown}
                                    disabled={!hasFolders}
                                >
                                    {hasFolders ? (
                                        folders.map((folder) => (
                                            <option key={folder.uid} value={folder.uid}>
                                                {folder.name}
                                            </option>
                                        ))
                                    ) : (
                                        <option value="">No folders available</option>
                                    )}
                                </select>
                                {selectedFolder && (
                                    <span
                                        className="bulk-collection-select-dot"
                                        style={{
                                            backgroundColor: selectedFolder.color && selectedFolder.color !== 'default'
                                                ? getColorValue(selectedFolder.color)
                                                : 'var(--primary-color)',
                                        }}
                                    />
                                )}
                            </div>
                        </div>

                        {!hasFolders && (
                            <div className="bulk-collection-modal-empty-state">
                                <MdFolder size={16} />
                                <span>Create a folder first to use bulk move.</span>
                            </div>
                        )}
                    </div>

                    <div className="bulk-collection-modal-footer">
                        <button
                            type="button"
                            className="bulk-collection-btn bulk-collection-btn-cancel"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="bulk-collection-btn bulk-collection-btn-primary"
                            onClick={handleConfirm}
                            disabled={!selectedFolderId}
                        >
                            Move Collections
                        </button>
                    </div>

                    <div className="bulk-collection-keyboard-hint">
                        Press <kbd>Enter</kbd> to move or <kbd>Esc</kbd> to cancel
                    </div>
                </div>
            </Activity>
        </Modal>
    );
}

export default BulkMoveCollectionsModal;
