import React, { useState, useEffect, useRef, Activity } from 'react';
import Modal from 'react-modal';
import { MdFolder, MdClose } from 'react-icons/md';
import './Modal.css';

function CreateFolderModal({ isOpen, onClose, onSave, folder }) {
    const isEditMode = !!folder;
    const [folderName, setFolderName] = useState('');
    const [selectedColor, setSelectedColor] = useState('#4facfe');
    const [isSaving, setIsSaving] = useState(false);
    const inputRef = useRef(null);

    const folderColors = [
        { name: 'Blue', value: '#4facfe' },
        { name: 'Green', value: '#43e97b' },
        { name: 'Purple', value: '#a855f7' },
        { name: 'Orange', value: '#fb923c' },
        { name: 'Red', value: '#ef4444' },
        { name: 'Yellow', value: '#eab308' },
        { name: 'Pink', value: '#ec4899' },
        { name: 'Teal', value: '#14b8a6' },
        { name: 'Gray', value: '#6b7280' }
    ];

    useEffect(() => {
        if (isOpen) {
            setFolderName(isEditMode ? (folder.name || '') : '');
            setSelectedColor(isEditMode ? (folder.color || '#4facfe') : '#4facfe');
            setIsSaving(false);
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    if (isEditMode) inputRef.current.select();
                }
            }, 100);
        }
    }, [isOpen, isEditMode, folder]);

    const handleSave = async () => {
        const trimmedName = folderName.trim();
        if (!trimmedName) return;

        setIsSaving(true);
        try {
            if (isEditMode) {
                Promise.resolve(onSave(trimmedName, selectedColor, folder.uid)).catch((error) => {
                    console.error('Error updating folder:', error);
                });
                onClose();
            } else {
                await onSave(trimmedName, selectedColor);
                onClose();
            }
        } catch (error) {
            console.error(isEditMode ? 'Error updating folder:' : 'Error creating folder:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    const handleCancel = () => {
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel={isEditMode ? "Edit Folder" : "Create New Folder"}
            className="create-folder-modal"
            overlayClassName="create-folder-modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="create-folder-modal-content">
                {/* Header */}
                <div className="create-folder-modal-header">
                    <div className="create-folder-modal-title">
                        <MdFolder 
                            style={{ 
                                color: selectedColor, 
                                fontSize: '20px', 
                                marginRight: '8px' 
                            }} 
                        />
                        <span>{isEditMode ? 'Edit Folder' : 'Create New Folder'}</span>
                    </div>
                    <button 
                        className="create-folder-modal-close"
                        onClick={handleCancel}
                        type="button"
                    >
                        <MdClose />
                    </button>
                </div>

                {/* Body */}
                <div className="create-folder-modal-body">
                    {/* Folder Name Input */}
                    <div className="create-folder-form-group">
                        <label htmlFor="folder-name-input" className="create-folder-label">
                            Folder Name
                        </label>
                        <input
                            ref={inputRef}
                            id="folder-name-input"
                            type="text"
                            value={folderName}
                            onChange={(e) => setFolderName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter folder name..."
                            className="create-folder-input"
                            maxLength={50}
                            disabled={isSaving}
                        />
                    </div>

                    {/* Color Selection */}
                    <div className="create-folder-form-group">
                        <label className="create-folder-label">
                            Folder Color
                        </label>
                        <div className="create-folder-color-grid">
                            {folderColors.map((color) => (
                                <button
                                    key={color.value}
                                    type="button"
                                    className={`create-folder-color-option ${
                                        selectedColor === color.value ? 'selected' : ''
                                    }`}
                                    style={{ backgroundColor: color.value }}
                                    onClick={() => setSelectedColor(color.value)}
                                    title={color.name}
                                    disabled={isSaving}
                                >
                                    {selectedColor === color.value && (
                                        <span className="create-folder-color-check">✓</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="create-folder-modal-footer">
                    <button
                        type="button"
                        className="create-folder-btn create-folder-btn-cancel"
                        onClick={handleCancel}
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="create-folder-btn create-folder-btn-save"
                        onClick={handleSave}
                        disabled={!folderName.trim() || isSaving}
                    >
                        {isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Folder'}
                    </button>
                </div>

                {/* Keyboard Hint */}
                <div className="create-folder-keyboard-hint">
                    Press <kbd>Enter</kbd> to {isEditMode ? 'save' : 'create'} or <kbd>Esc</kbd> to cancel
                </div>
            </div>
            </Activity>
        </Modal>
    );
}

export default CreateFolderModal; 
