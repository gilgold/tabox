import React from 'react';
import './SnackbarWithUndo.css';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import { UndoButton } from './UndoButton';
import { IoClose } from 'react-icons/io5';

export const SnackBarWithUndo = (props) => {
    return <div className="snackbar-wrapper">
        <div className="snackbar-column snackbar-icon">
            { props.icon ?? '' }
        </div>
        <div className="snackbar-column snackbar-extended-col">
            <div className="snackbar-text-upper">{props.collectionName.trim()}</div>
            <div className="snackbar-text-lower">{props.message}</div>
        </div>
        <div className="snackbar-column snackbar-buttons-wrapper">
            <UndoButton
                updateRemoteData={props.updateRemoteData}
                collections={props.collections}
                closeSnackbar={props.closeSnackbar}
            />
            <span style={{ width: '5px' }} />
            <CountdownCircleTimer
                isPlaying
                size={36}
                trailColor={'snow'}
                trailStrokeWidth={3}
                rotation={'counterclockwise'}
                strokeWidth={4}
                duration={props.duration}
                colors={[
                [props.undoBackgroundColor, 1],
                ]}
            >
                {() => <button className="snackbar-button" onClick={props.closeSnackbar}><IoClose size="24px" /></button>}
            </CountdownCircleTimer>
        </div>
    </div>
};