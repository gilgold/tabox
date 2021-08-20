import React from 'react';
import './UndoButton.css';
import { FaUndoAlt } from 'react-icons/fa';

export const UndoButton = (props) => {
    const handleUndo = async () => {
        props.updateRemoteData(props.collections);
        props.closeSnackbar();
    }

    return <button 
        className="snackbar-button undo-button" 
        onClick={async () => await handleUndo()}
        title="Undo this action"
        >
            <FaUndoAlt />
        </button>
}