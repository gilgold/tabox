import React from 'react';
import './SnackbarWithUndo.css';
import { UndoButton } from './UndoButton';

export const SnackBarWithUndo = (props) => {
    return <div className="snackbar-wrapper">
        <div className="snackbar-column">
            <UndoButton
                updateRemoteData={props.updateRemoteData}
                collections={props.collections}
                closeSnackbar={props.closeSnackbar}
                backgroundColor={props.undoBackgroundColor}
                duration={props.duration}
            />
        </div>
        <div className="snackbar-column">
            <div className="snackbar-text-upper">{props.collectionName.trim()}</div>
            <div className="snackbar-text-lower">{props.message}</div>
        </div>
    </div>
};