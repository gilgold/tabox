import React, { useState, useEffect, useRef, Activity } from 'react';
import Modal from 'react-modal';
import { MdSave, MdClose } from 'react-icons/md';
import { getCurrentTabsAndGroups, getAllWindowsTabsAndGroups } from '../utils';
import { getColorValue } from '../utils/colorMigration';
import { saveCollectionSnapshot } from '../utils/saveCollectionSnapshot';
import { browser } from '../../static/globals';
import { triggerBackgroundSync } from '../utils/sharedSync';
import { showSuccessToast, showErrorToast } from '../toastHelpers';
import AiSuggestNameButton from '../AiSuggestNameButton';
import { suggestCollectionName } from '../ai/tasks/suggestCollectionName';
import { suggestFolderName } from '../ai/tasks/suggestFolderName';
import './SaveCollectionModal.css';

const FOLDER_COLOR_OPTIONS = [
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

function SaveCollectionModal({
    isOpen,
    onClose,
    folders,
    addCollection,
    addFolder,
    onDataUpdate,
    onSaved,
    sessionCollection,
    snapshotCollection,
    initialSaveMode = 'current',
    lockSaveMode = false,
}) {
    const [name, setName] = useState('');
    const [saveMode, setSaveMode] = useState('current');
    const [selectedFolder, setSelectedFolder] = useState('');
    const [selectedFolderColor, setSelectedFolderColor] = useState('#4facfe');
    const [isSaving, setIsSaving] = useState(false);
    const [windowCount, setWindowCount] = useState(1);
    const [aiBusy, setAiBusy] = useState(false);
    const inputRef = useRef(null);
    const sourceCollection = snapshotCollection || sessionCollection;
    const activeSaveMode = lockSaveMode ? initialSaveMode : saveMode;
    const isSavingAllWindows = !sourceCollection && activeSaveMode === 'all';

    useEffect(() => {
        if (isOpen) {
            setName(sourceCollection?.name || '');
            setSaveMode(initialSaveMode);
            setSelectedFolder('');
            setSelectedFolderColor('#4facfe');
            setIsSaving(false);
            if (!sourceCollection) checkWindowCount();
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    if (sourceCollection) inputRef.current.select();
                }
            }, 100);
        }
    }, [initialSaveMode, isOpen, sourceCollection]);

    const checkWindowCount = async () => {
        try {
            const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
            setWindowCount(windows.length);
        } catch {
            setWindowCount(1);
        }
    };

    const handleSave = async () => {
        const trimmed = name.trim();
        if (!trimmed) return;

        setIsSaving(true);
        try {
            if (sourceCollection) {
                await saveCollectionSnapshot({
                    snapshot: sourceCollection,
                    name: trimmed,
                    parentId: selectedFolder,
                    addCollection,
                    onDataUpdate,
                    onSaved,
                });
                const folderLabel = selectedFolder
                    ? folders.find(f => f.uid === selectedFolder)?.name
                    : null;
                showSuccessToast(
                    folderLabel
                        ? `"${trimmed}" saved to ${folderLabel}`
                        : `"${trimmed}" saved`
                );
            } else if (activeSaveMode === 'all') {
                const { folder, collections } = await getAllWindowsTabsAndGroups(trimmed, selectedFolderColor);
                const createdFolder = await addFolder(folder.name, folder.color, folder.collapsed);
                if (!createdFolder) throw new Error('Failed to create folder');

                for (const collection of collections) {
                    collection.parentId = createdFolder.uid;
                    await addCollection(collection, true, true);
                }
                const { updateFolderCollectionCount } = await import('../utils/storageUtils');
                await updateFolderCollectionCount(createdFolder.uid);
                await triggerBackgroundSync({ refreshContextMenu: true });
                if (onDataUpdate) await onDataUpdate();
                if (onSaved) onSaved(collections);
                showSuccessToast(`Folder created with ${collections.length} collections`);
            } else {
                const newItem = await getCurrentTabsAndGroups(trimmed);
                if (selectedFolder) {
                    newItem.parentId = selectedFolder;
                }
                await addCollection(newItem, false, true);
                if (onDataUpdate) await onDataUpdate();
                if (onSaved) onSaved(newItem);
                const folderLabel = selectedFolder
                    ? folders.find(f => f.uid === selectedFolder)?.name
                    : null;
                showSuccessToast(
                    folderLabel
                        ? `"${trimmed}" saved to ${folderLabel}`
                        : `"${trimmed}" saved`
                );
            }
            onClose();
        } catch (error) {
            showErrorToast(`Save failed: ${error.message}`);
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

    const showModeToggle = !sourceCollection && !lockSaveMode && windowCount > 1;
    const showFolderPicker = (sourceCollection || activeSaveMode === 'current') && folders && folders.length > 0;
    const showFolderColorPicker = activeSaveMode === 'all';

    const suggestName = async () => {
        if (sourceCollection) return suggestCollectionName(sourceCollection);
        if (activeSaveMode === 'all') {
            const { collections } = await getAllWindowsTabsAndGroups('');
            return suggestFolderName({ collections });
        }
        const collection = await getCurrentTabsAndGroups('');
        return suggestCollectionName(collection);
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Save Collection"
            className="save-collection-modal"
            overlayClassName="save-collection-modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="save-collection-modal-content">
                    <div className="save-collection-modal-header">
                        <div className="save-collection-modal-title">
                            <MdSave style={{ fontSize: '20px', marginRight: '8px', color: 'var(--primary-color)' }} />
                            <span>{isSavingAllWindows ? 'Save All Windows' : 'Save Collection'}</span>
                        </div>
                        <button className="save-collection-modal-close" onClick={onClose} type="button">
                            <MdClose />
                        </button>
                    </div>

                    <div className="save-collection-modal-body">
                        <div className="save-collection-form-group">
                            <label htmlFor="save-collection-name" className="save-collection-label">
                                {isSavingAllWindows ? 'Folder Name' : 'Collection Name'}
                            </label>
                            <div className={`save-collection-input-wrap${aiBusy ? ' ai-name-processing' : ''}`}>
                                <input
                                    ref={inputRef}
                                    id="save-collection-name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={isSavingAllWindows ? 'Enter a name for your folder...' : 'Enter a name for your collection...'}
                                    className="save-collection-input"
                                    maxLength={50}
                                    disabled={isSaving}
                                />
                                <AiSuggestNameButton
                                    suggest={suggestName}
                                    onSuggested={setName}
                                    onBusyChange={setAiBusy}
                                    disabled={isSaving}
                                />
                            </div>
                        </div>

                        {showModeToggle && (
                            <div className="save-collection-form-group">
                                <label className="save-collection-label">Save Mode</label>
                                <div className="save-collection-mode-toggle">
                                    <button
                                        type="button"
                                        className={`save-collection-mode-btn ${activeSaveMode === 'current' ? 'active' : ''}`}
                                        onClick={() => setSaveMode('current')}
                                    >
                                        Current Window
                                    </button>
                                    <button
                                        type="button"
                                        className={`save-collection-mode-btn ${activeSaveMode === 'all' ? 'active' : ''}`}
                                        onClick={() => setSaveMode('all')}
                                    >
                                        All Windows
                                    </button>
                                </div>
                            </div>
                        )}

                        {showFolderPicker && (
                            <div className="save-collection-form-group">
                                <label htmlFor="save-collection-folder" className="save-collection-label">
                                    Save To
                                </label>
                                <div className="save-collection-folder-select-wrapper">
                                    <select
                                        id="save-collection-folder"
                                        className="save-collection-folder-select"
                                        value={selectedFolder}
                                        onChange={(e) => setSelectedFolder(e.target.value)}
                                        disabled={isSaving}
                                    >
                                        <option value="">Root level (no folder)</option>
                                        {folders.map(f => (
                                            <option key={f.uid} value={f.uid}>
                                                {f.name}
                                            </option>
                                        ))}
                                    </select>
                                    {selectedFolder && (
                                        <span
                                            className="save-collection-folder-dot"
                                            style={{
                                                backgroundColor: (() => {
                                                    const f = folders.find(fo => fo.uid === selectedFolder);
                                                    return f?.color && f.color !== 'default' ? getColorValue(f.color) : 'var(--primary-color)';
                                                })()
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {showFolderColorPicker && (
                            <div className="save-collection-form-group">
                                <label className="save-collection-label">
                                    Folder Color
                                </label>
                                <div className="save-collection-color-grid">
                                    {FOLDER_COLOR_OPTIONS.map((color) => (
                                        <button
                                            key={color.value}
                                            type="button"
                                            className={`save-collection-color-option ${selectedFolderColor === color.value ? 'selected' : ''}`}
                                            style={{ backgroundColor: color.value }}
                                            onClick={() => setSelectedFolderColor(color.value)}
                                            aria-label={`Choose ${color.name} folder color`}
                                            title={color.name}
                                            disabled={isSaving}
                                        >
                                            {selectedFolderColor === color.value && (
                                                <span className="save-collection-color-check">✓</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeSaveMode === 'all' && (
                            <div className="save-collection-hint">
                                Each window will be saved as a separate collection inside a new folder.
                            </div>
                        )}
                    </div>

                    <div className="save-collection-modal-footer">
                        <button
                            type="button"
                            className="save-collection-btn save-collection-btn-cancel"
                            onClick={onClose}
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="save-collection-btn save-collection-btn-save"
                            onClick={handleSave}
                            disabled={!name.trim() || isSaving}
                        >
                            {isSaving ? 'Saving...' : activeSaveMode === 'all' ? 'Save All Windows' : 'Save Collection'}
                        </button>
                    </div>

                    <div className="save-collection-keyboard-hint">
                        Press <kbd>Enter</kbd> to save or <kbd>Esc</kbd> to cancel
                    </div>
                </div>
            </Activity>
        </Modal>
    );
}

export default SaveCollectionModal;
