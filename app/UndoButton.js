import React, { useRef, useEffect } from 'react';
import { FaUndoAlt } from 'react-icons/fa';

export const UndoButton = (props) => {
    // Capture the undoAction in a ref on mount to prevent it from changing
    // This fixes the bug where multiple toasts would all execute the same (last) undo action
    const undoActionRef = useRef(props.undoAction);
    const closeSnackbarRef = useRef(props.closeSnackbar);
    
    // Only capture on mount - don't update refs after initial render
    useEffect(() => {
        undoActionRef.current = props.undoAction;
        closeSnackbarRef.current = props.closeSnackbar;
    }, []); // Empty deps - only run on mount

    const handleUndo = async () => {
        if (undoActionRef.current) {
            await undoActionRef.current();
        }
        if (closeSnackbarRef.current) {
            closeSnackbarRef.current();
        }
    }

    return <button 
        className="snackbar-button" 
        onClick={async () => await handleUndo()}
        title="Undo this action"
        >
            <FaUndoAlt />
        </button>
}