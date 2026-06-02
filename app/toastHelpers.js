import React from 'react';
import toast from 'react-hot-toast';
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
const createSharedToast = ({ duration, position, toasterId, ...toastProps }) => toast.custom(
    (t) => (
        <FPToast
            t={t}
            duration={duration}
            visible={t.visible}
            {...toastProps}
        />
    ),
    { duration, position, toasterId }
);

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
    const toastId = createSharedToast({
        duration: durationMs,
        position,
        variant: 'undo',
        icon,
        title: collectionName.trim(),
        message,
        undoAction,
    });

    trackToast(toastId);
    return toastId;
};

/**
 * Show a simple success toast
 * @param {string} message - Message to display
 * @param {number} duration - Duration in ms (default 3000)
 */
export const showSuccessToast = (message, duration = 3000, options = {}) => {
    enforceToastLimit();

    const position = getPosition();
    const toastId = createSharedToast({
        duration,
        position,
        toasterId: options.toasterId,
        variant: 'success',
        message,
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
    const toastId = createSharedToast({
        duration,
        position,
        variant: 'info',
        message,
    });

    trackToast(toastId);
    return toastId;
};

/**
 * Show a simple error toast
 */
export const showErrorToast = (message, options = {}) => {
    enforceToastLimit();

    const position = getPosition();
    const toastId = createSharedToast({
        duration: 4000,
        position,
        toasterId: options.toasterId,
        variant: 'error',
        message,
    });

    trackToast(toastId);
    return toastId;
};
