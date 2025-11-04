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
            <CountdownCircleTimer
                isPlaying
                size={24}
                trailColor={'rgba(255, 255, 255, 0.15)'}
                trailStrokeWidth={2}
                rotation={'counterclockwise'}
                strokeWidth={2}
                duration={props.duration}
                colors={[
                    'rgba(255, 255, 255, 0.8)', 
                    'rgba(255, 255, 255, 0.6)',
                ]}
            >
                {() => <button className="snackbar-button" onClick={props.closeSnackbar}><IoClose size="14px" /></button>}
            </CountdownCircleTimer>
        </div>
    </div>
};