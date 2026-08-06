import React from 'react';
import Modal from 'react-modal';
import { useAtom } from 'jotai';
import { MdLock, MdClose } from 'react-icons/md';
import { noPermissionOpenState } from './atoms/sharedFoldersState';
import './Modal.css';
import './NoPermissionModal.css';

export default function NoPermissionModal() {
    const [isOpen, setIsOpen] = useAtom(noPermissionOpenState);

    if (!isOpen) return null;

    const close = () => setIsOpen(false);

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={close}
            contentLabel="No permission"
            className="modal-content no-permission-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
        >
            <div className="no-permission-header">
                <MdLock size={22} />
                <h3>View-only folder</h3>
                <button className="no-permission-close" onClick={close} type="button" aria-label="Close">
                    <MdClose size={18} />
                </button>
            </div>
            <p>You don&apos;t have permission to edit this folder. Ask the folder owner for full access if you need to make changes.</p>
            <button className="no-permission-ok" onClick={close} type="button">Got it</button>
        </Modal>
    );
}
