import React from 'react';
import Modal from 'react-modal';
import { MdFolder, MdCheck } from 'react-icons/md';
import { getColorValue } from './utils/colorMigration';
import './QuickSaveFolderModal.css';

function QuickSaveFolderModal({ isOpen, onClose, onSelect, folders, destinationId, unavailable }) {
    const choices = [{ uid: '', name: 'root' }, ...folders];

    // Buttons retain native Enter/Space activation. Arrow keys move among the
    // current choices, including after a live folder list update.
    const handleKeyDown = event => {
        event.stopPropagation();
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('[data-folder-uid]'));
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Save to folder"
            aria={{ labelledby: 'quick-save-folder-heading' }}
            className="quick-save-modal"
            overlayClassName="quick-save-modal-overlay"
            ariaHideApp={Boolean(document.getElementById('root'))}
            appElement={document.getElementById('root') || undefined}
            contentElement={(props, children) => (
                <div {...props} onKeyDown={event => { props.onKeyDown(event); handleKeyDown(event); }}>
                    {children}
                </div>
            )}
        >
            <h2 id="quick-save-folder-heading">Save to folder</h2>
            {unavailable && <p role="status">Destination unavailable — choose another folder or root.</p>}
            <div className="quick-save-folder-list" aria-label="Destinations">
                {choices.map(folder => (
                    <button
                        type="button"
                        key={folder.uid}
                        data-folder-uid={folder.uid}
                        className={`quick-save-folder-choice${!folder.uid ? ' is-root' : ''}`}
                        aria-label={folder.name}
                        aria-pressed={destinationId === folder.uid}
                        onClick={() => onSelect(folder.uid)}
                    >
                        <MdFolder aria-hidden="true" style={folder.uid ? { color: folder.color && folder.color !== 'default' ? getColorValue(folder.color) : 'var(--primary-color)' } : undefined} />
                        <span>{folder.name}</span>
                        {destinationId === folder.uid && <MdCheck className="quick-save-folder-check" aria-hidden="true" />}
                    </button>
                ))}
            </div>
            {folders.length === 0 && <p>No writable folders available. You can save to root.</p>}
            <button type="button" className="quick-save-modal-cancel" onClick={onClose}>Cancel</button>
        </Modal>
    );
}

export default QuickSaveFolderModal;
