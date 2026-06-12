import { useEffect, useRef, useState } from 'react';
import { browser } from '../../static/globals';

// Mirrors the Switch component's storage pattern: read once, stay in sync
// via storage.onChanged so the header button reacts to the settings toggle.
// The `loaded` ref prevents a slow initial read from clobbering a fresher
// onChanged value, same as Switch.js.
export function useTaboxAIEnabled() {
    const [enabled, setEnabled] = useState(false);
    const loaded = useRef(false);

    useEffect(() => {
        browser.storage.local.get('chkTaboxAI').then(({ chkTaboxAI }) => {
            if (!loaded.current) {
                setEnabled(!!chkTaboxAI);
                loaded.current = true;
            }
        }).catch(() => {});

        const onStorageChanged = (changes) => {
            if (changes.chkTaboxAI && changes.chkTaboxAI.newValue !== undefined) {
                loaded.current = true;
                setEnabled(!!changes.chkTaboxAI.newValue);
            }
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        return () => browser.storage.onChanged.removeListener(onStorageChanged);
    }, []);

    return enabled;
}
