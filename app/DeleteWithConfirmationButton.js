import React, {useState} from 'react';
import './DeleteWithConfirmationButton.css';

const DeleteWithConfirmationButton = (props) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmDisabled, setConfirmDisabled] = useState(true);

    const toggleSlideConfirm = () => {
        setConfirmDisabled(true);
        setConfirmOpen(!confirmOpen);
        setTimeout(() => setConfirmDisabled(false), 400);
    }

    const handleDelete = () => {
        props.action(props.group.uid);
    }

    return <div className="slider-wrapper">
        <div className={`slider ${confirmOpen ? 'slider-open' : null}`}>
            <button className="slider-button" disabled={confirmDisabled} data-tip="Delete this group and all its tabs?" data-class="small-tooltip" onClick={handleDelete}>Delete</button>
        </div>
        <div title={confirmOpen ? 'Cancel' : `Delete group '${props.group.title}'`} className="del slider-del" onClick={toggleSlideConfirm} />
    </div>
}

export default DeleteWithConfirmationButton;