import { useEffect, useState } from 'react';
import { browser } from '../../static/globals';

// Mirrors the Switch component's storage pattern: read once, stay in sync
// via storage.onChanged so the header button reacts to the settings toggle.
export function useTaboxAIEnabled() {
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        browser.storage.local.get('chkTaboxAI').then(({ chkTaboxAI }) => setEnabled(!!chkTaboxAI));

        const onStorageChanged = (changes) => {
            if (changes.chkTaboxAI && changes.chkTaboxAI.newValue !== undefined) {
                setEnabled(!!changes.chkTaboxAI.newValue);
            }
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        return () => browser.storage.onChanged.removeListener(onStorageChanged);
    }, []);

    return enabled;
}
