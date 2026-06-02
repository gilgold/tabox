import React from 'react';
import { browser } from '../../static/globals';

function ClickableTabUrl({ url, children, className = 'tab-url-preview' }) {
    if (!url) {
        return null;
    }

    const handleOpenUrl = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await browser.tabs.create({ url, active: true });
    };

    return (
        <button
            type="button"
            className={`${className} tab-url-preview-button`}
            title={url}
            onClick={handleOpenUrl}
        >
            {children || url}
        </button>
    );
}

export default ClickableTabUrl;
