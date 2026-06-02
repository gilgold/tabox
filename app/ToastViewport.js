import React from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'react-hot-toast';

export const ToastViewport = ({
    context = 'popup',
    toasterId,
    disablePortal = false,
}) => {
    const isFullPage = context === 'fullpage';
    const containerStyle = isFullPage
        ? { bottom: 24, right: 24, zIndex: 2147483647 }
        : { bottom: 16 };
    const containerClassName = isFullPage
        ? 'tabox-toast-viewport tabox-toast-viewport--fullpage'
        : 'tabox-toast-viewport tabox-toast-viewport--popup';

    const toaster = (
        <Toaster
            toasterId={toasterId}
            position={isFullPage ? 'bottom-right' : 'bottom-center'}
            containerClassName={containerClassName}
            containerStyle={containerStyle}
            toastOptions={{
                duration: 3000,
                style: {
                    background: 'transparent',
                    boxShadow: 'none',
                    padding: 0,
                },
            }}
        />
    );

    if (disablePortal || typeof document === 'undefined' || !document.body) {
        return toaster;
    }

    return createPortal(toaster, document.body);
};
