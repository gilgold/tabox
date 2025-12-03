import React from 'react';
import toast from 'react-hot-toast';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { UNDO_TIME } from './constants';

// Track active toast IDs to enforce max limit
const MAX_TOASTS = 2;
const activeToastIds = [];

/**
 * Enforce max toast limit by dismissing oldest toast if needed
 */
const enforceToastLimit = () => {
    while (activeToastIds.length >= MAX_TOASTS) {
        const oldestId = activeToastIds.shift();
        toast.dismiss(oldestId);
    }
};

/**
 * Track a new toast ID and remove it when dismissed
 */
const trackToast = (toastId) => {
    activeToastIds.push(toastId);
};

/**
 * Show a toast with undo functionality (for deletions/updates)
 * @param {ReactElement} icon - Icon to display
 * @param {string} message - Message text
 * @param {string} collectionName - Name of the collection
 * @param {Function} undoAction - Async function to call on undo
 * @param {number} duration - Duration in seconds (default from UNDO_TIME)
 */
export const showUndoToast = (
    icon,
    message,
    collectionName,
    undoAction,
    duration = UNDO_TIME
) => {
    enforceToastLimit();
    
    const toastId = toast.custom(
        (t) => (
            <SnackBarWithUndo
                t={t}
                icon={icon}
                message={message}
                collectionName={collectionName}
                undoAction={undoAction}
                duration={duration * 1000}
                visible={t.visible}
            />
        ),
        {
            duration: duration * 1000,
            position: 'bottom-center',
        }
    );
    
    trackToast(toastId);
    return toastId;
};

/**
 * Show a simple success toast
 */
export const showSuccessToast = (message) => {
    enforceToastLimit();
    
    const toastId = toast.success(message, {
        duration: 3000,
        position: 'bottom-center',
        style: {
            background: '#4caf50',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '8px',
        },
    });
    
    trackToast(toastId);
    return toastId;
};

/**
 * Show a simple error toast
 */
export const showErrorToast = (message) => {
    enforceToastLimit();
    
    const toastId = toast.error(message, {
        duration: 4000,
        position: 'bottom-center',
        style: {
            background: '#f44336',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '8px',
        },
    });
    
    trackToast(toastId);
    return toastId;
};

