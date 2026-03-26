import React, { useRef, useEffect } from 'react';
import { IoClose } from 'react-icons/io5';
import { FaUndoAlt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import './FPToast.css';

const FPUndoButton = ({ undoAction, closeToast }) => {
    const undoActionRef = useRef(undoAction);
    const closeToastRef = useRef(closeToast);

    useEffect(() => {
        undoActionRef.current = undoAction;
        closeToastRef.current = closeToast;
    }, []);

    const handleUndo = async () => {
        if (undoActionRef.current) {
            await undoActionRef.current();
        }
        if (closeToastRef.current) {
            closeToastRef.current();
        }
    };

    return (
        <button
            className="fp-toast-undo-btn"
            onClick={handleUndo}
            title="Undo this action"
        >
            <FaUndoAlt size={12} />
            <span>Undo</span>
        </button>
    );
};

const VARIANT_CONFIG = {
    success: { accent: 'var(--fp-toast-accent-success)', icon: '✓' },
    error:   { accent: 'var(--fp-toast-accent-error)',   icon: '✕' },
    info:    { accent: 'var(--fp-toast-accent-info)',     icon: 'ℹ' },
    undo:    { accent: 'var(--fp-toast-accent-success)',  icon: null },
};

export const FPToast = ({
    t,
    variant = 'success',
    icon,
    title,
    message,
    undoAction,
    duration = 3000,
    visible,
}) => {
    const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.success;
    const animationDuration = duration / 1000;
    const dismiss = () => toast.dismiss(t.id);

    const displayIcon = icon ?? config.icon;

    return (
        <div
            className={`fp-toast fp-toast--${variant}`}
            style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateX(0)' : 'translateX(20px)',
                transition: 'all 0.3s var(--fp-ease)',
            }}
        >
            <div
                className="fp-toast-accent"
                style={{ background: config.accent }}
            />
            <div className="fp-toast-body">
                {displayIcon && (
                    <div className="fp-toast-icon">{displayIcon}</div>
                )}
                <div className="fp-toast-content">
                    {title && <div className="fp-toast-title">{title}</div>}
                    {message && <div className="fp-toast-message">{message}</div>}
                </div>
                <div className="fp-toast-actions">
                    {variant === 'undo' && undoAction && (
                        <FPUndoButton
                            undoAction={undoAction}
                            closeToast={dismiss}
                        />
                    )}
                    <button
                        className="fp-toast-close-btn"
                        onClick={dismiss}
                        title="Close"
                    >
                        <svg
                            className="fp-toast-countdown"
                            viewBox="0 0 28 28"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <circle
                                className="fp-toast-countdown-bg"
                                cx="14"
                                cy="14"
                                r="12"
                            />
                            <circle
                                className="fp-toast-countdown-progress"
                                cx="14"
                                cy="14"
                                r="12"
                                style={{
                                    animation: `fpToastCountdown ${animationDuration}s linear forwards`,
                                }}
                            />
                        </svg>
                        <IoClose size={14} className="fp-toast-close-icon" />
                    </button>
                </div>
            </div>
        </div>
    );
};
