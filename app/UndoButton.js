import React from 'react';
import './UndoButton.css';
import { CountdownCircleTimer } from 'react-countdown-circle-timer'

export const UndoButton = (props) => {
    const handleUndo = async () => {
        props.updateRemoteData(props.collections);
        props.closeSnackbar();
    }

    return <CountdownCircleTimer
        isPlaying
        size={36}
        trailColor={'snow'}
        trailStrokeWidth={3}
        rotation={'counterclockwise'}
        strokeWidth={5}
        duration={props.duration}
        colors={[
        [props.backgroundColor, 1],
        ]}
    >
        {({ remainingTime }) => <button className="undo-button" onClick={async () => await handleUndo()}>undo</button>}
    </CountdownCircleTimer>
}