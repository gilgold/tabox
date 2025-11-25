import React from 'react';
import './SnackbarWithUndo.css';
import { UndoButton } from './UndoButton';
import { IoClose } from 'react-icons/io5';
import toast from 'react-hot-toast';

export const SnackBarWithUndo = (props) => {
    const { t, duration = 5000 } = props;
    
    // Calculate animation duration in seconds
    const animationDuration = duration / 1000;
    
    return (
        <div 
            className="snackbar-wrapper"
            style={{
                opacity: props.visible ? 1 : 0,
                transform: props.visible ? 'translateY(0)' : 'translateY(10px)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
        >
        <div className="snackbar-column snackbar-icon">
                {props.icon ?? ''}
        </div>
        <div className="snackbar-column snackbar-extended-col">
            <div className="snackbar-text-upper">{props.collectionName.trim()}</div>
            <div className="snackbar-text-lower">{props.message}</div>
        </div>
        <div className="snackbar-column snackbar-buttons-wrapper">
            <UndoButton
                    undoAction={props.undoAction}
                    closeSnackbar={() => toast.dismiss(t.id)}
            />
                <button 
                    className="snackbar-button snackbar-close-button" 
                    onClick={() => toast.dismiss(t.id)}
                    title="Close"
                >
                    <svg className="countdown-circle" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <circle 
                            className="countdown-circle-bg" 
                            cx="12" 
                            cy="12" 
                            r="11"
                        />
                        <circle 
                            className="countdown-circle-progress" 
                            cx="12" 
                            cy="12" 
                            r="11"
                            style={{
                                animation: `countdown ${animationDuration}s linear forwards`,
                                animationPlayState: 'running'
                            }}
                        />
                    </svg>
                    <IoClose size="12px" className="close-icon" />
                </button>
            </div>
        </div>
    );
};