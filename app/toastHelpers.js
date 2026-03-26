import React from 'react';
import toast from 'react-hot-toast';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { FPToast } from './fullpage/FPToast';
import { UNDO_TIME } from './constants';

const MAX_TOASTS = 2;
const activeToastIds = [];

let currentViewContext = 'popup';

export const setToastViewContext = (context) => {
    currentViewContext = context;
};

const isFullPage = () => currentViewContext === 'fullpage';
const getPosition = () => isFullPage() ? 'bottom-right' : 'bottom-center';

const enforceToastLimit = () => {
    while (activeToastIds.length >= MAX_TOASTS) {
        const oldestId = activeToastIds.shift();
        toast.dismiss(oldestId);
    }
};

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

    const durationMs = duration * 1000;
    const position = getPosition();

    const toastId = isFullPage()
        ? toast.custom(
            (t) => (
                <FPToast
                    t={t}
                    variant="undo"
                    icon={icon}
                    title={collectionName.trim()}
                    message={message}
                    undoAction={undoAction}
                    duration={durationMs}
                    visible={t.visible}
                />
            ),
            { duration: durationMs, position }
        )
        : toast.custom(
            (t) => (
                <SnackBarWithUndo
                    t={t}
                    icon={icon}
                    message={message}
                    collectionName={collectionName}
                    undoAction={undoAction}
                    duration={durationMs}
                    visible={t.visible}
                />
            ),
            { duration: durationMs, position }
        );

    trackToast(toastId);
    return toastId;
};

/**
 * Show a simple success toast
 * @param {string} message - Message to display
 * @param {number} duration - Duration in ms (default 3000)
 */
export const showSuccessToast = (message, duration = 3000) => {
    enforceToastLimit();

    const position = getPosition();

    const toastId = isFullPage()
        ? toast.custom(
            (t) => (
                <FPToast
                    t={t}
                    variant="success"
                    message={message}
                    duration={duration}
                    visible={t.visible}
                />
            ),
            { duration, position }
        )
        : toast.success(message, {
            duration,
            position,
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
 * Show a warning/info toast (for incognito and other informational messages)
 * @param {string} message - Message to display
 * @param {number} duration - Duration in ms (default 4000)
 */
export const showInfoToast = (message, duration = 4000) => {
    enforceToastLimit();

    const position = getPosition();

    const toastId = isFullPage()
        ? toast.custom(
            (t) => (
                <FPToast
                    t={t}
                    variant="info"
                    message={message}
                    duration={duration}
                    visible={t.visible}
                />
            ),
            { duration, position }
        )
        : toast(message, {
            duration,
            position,
            icon: 'ℹ️',
            style: {
                background: '#2196f3',
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

    const position = getPosition();

    const toastId = isFullPage()
        ? toast.custom(
            (t) => (
                <FPToast
                    t={t}
                    variant="error"
                    message={message}
                    duration={4000}
                    visible={t.visible}
                />
            ),
            { duration: 4000, position }
        )
        : toast.error(message, {
            duration: 4000,
            position,
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
