import React, { useState } from 'react';
import './DeleteWithConfirmationButton.css';
import { MdDeleteForever } from 'react-icons/md';

const DeleteWithConfirmationButton = (props) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmDisabled, setConfirmDisabled] = useState(true);

    const toggleSlideConfirm = (e) => {
        e.stopPropagation();
        setConfirmDisabled(true);
        setConfirmOpen(!confirmOpen);
        setTimeout(() => setConfirmDisabled(false), 400);
    }

    const handleDelete = (e) => {
        e.stopPropagation();
        props.action(props.group.uid);
    }

    return <div className="slider-wrapper" onClick={(e) => e.stopPropagation()}>
        <div data-tooltip-id="main-tooltip" data-tooltip-content={confirmOpen ? 'Cancel' : `Delete group '${props.group.title}'`} className="del" onClick={(e) => { e.stopPropagation(); toggleSlideConfirm(e); }}>
            <MdDeleteForever color="#B64A4A" size="18px" />
        </div>
        <div className={`slider ${confirmOpen ? 'slider-open' : null}`}>
            <button className="slider-button" disabled={confirmDisabled} data-tooltip-id="main-tooltip" data-tooltip-content="Delete this group and all its tabs?" data-tooltip-class-name="small-tooltip" onClick={(e) => { e.stopPropagation(); handleDelete(e); }}>Delete</button>
        </div>
    </div>
}

export default DeleteWithConfirmationButton;