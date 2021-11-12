import React from 'react';
import './Modal.css';
import { IoIosWarning } from 'react-icons/io';

export const Modal = (props) => {
    return (
        <div className='modal-card'>
            <div className='modal-card-wrapper'>
                <div className='modal-card-image'>
                    <IoIosWarning color="#FFCC00" size="70px" />
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