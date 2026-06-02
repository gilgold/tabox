import React, { useState, useRef, useEffect, useCallback } from 'react';
import './DeleteWithConfirmationButton.css';
import { HiOutlineTrash } from 'react-icons/hi2';

const DeleteWithConfirmationButton = (props) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmDisabled, setConfirmDisabled] = useState(true);
    const wrapperRef = useRef(null);

    const closeConfirm = useCallback(() => {
        setConfirmOpen(false);
    }, []);

    useEffect(() => {
        if (!confirmOpen) return;
        const handleClickOutside = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                closeConfirm();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [confirmOpen, closeConfirm]);

    const toggleSlideConfirm = (e) => {
        e.stopPropagation();
        setConfirmDisabled(true);
        setConfirmOpen(!confirmOpen);
        setTimeout(() => setConfirmDisabled(false), 350);
    }

    const handleDelete = (e) => {
        e.stopPropagation();
        props.action(props.group.uid);
    }

    return (
        <div className={`del-confirm-wrapper ${confirmOpen ? 'is-confirming' : ''}`} ref={wrapperRef} onClick={(e) => e.stopPropagation()}>
            <button
                className={`del-confirm-trigger ${confirmOpen ? 'active' : ''}`}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={confirmOpen ? 'Cancel' : `Delete group '${props.group.title}'`}
                onClick={toggleSlideConfirm}
            >
                <HiOutlineTrash />
            </button>
            <div className={`del-confirm-slide ${confirmOpen ? 'open' : ''}`}>
                <button
                    className="del-confirm-btn"
                    disabled={confirmDisabled}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content="Delete this group and all its tabs"
                    data-tooltip-class-name="small-tooltip"
                    onClick={handleDelete}
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

export default DeleteWithConfirmationButton;