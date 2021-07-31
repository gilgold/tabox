import React from 'react';
import './Modal.css';

export const Modal = (props) => {
    return (
        <div className='modal-card'>
            <div className='modal-card-wrapper'>
                <div className='modal-card-image'>
                    <img src="./images/warning.svg" alt='warning image' />
                </div>
                <div className='modal-card-content'>
                    <div className='modal-card-header'>
                        {props.title}
                    </div>
                    <div className='modal-card-body'>
                        { props.message }
                    </div>
                </div>
            </div>
            <div className="button-row">
                <button className="modal-button" onClick={props.onClose}>{props.cancelLabel}</button>
                <button className="modal-button primary" onClick={props.onConfirm}>{props.confirmLabel}</button>
            </div>
        </div>
    );
}