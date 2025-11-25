import React from 'react';
import toast from 'react-hot-toast';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { UNDO_TIME } from './constants';

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
    return toast.custom(
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
};

/**
 * Show a simple success toast
 */
export const showSuccessToast = (message) => {
    return toast.success(message, {
        duration: 3000,
        position: 'bottom-center',
        style: {
            background: '#4caf50',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '8px',
        },
    });
};

/**
 * Show a simple error toast
 */
export const showErrorToast = (message) => {
    return toast.error(message, {
        duration: 4000,
        position: 'bottom-center',
        style: {
            background: '#f44336',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '8px',
        },
    });
};

