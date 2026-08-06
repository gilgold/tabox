// app/ai/useSmartOrganizeUndo.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from '../../static/globals';

const KEY = 'smartOrganizeUndo';

// Live view of the persistent Smart Organize undo snapshot. Drives the toolbar
// "Undo Smart Organize" chip; survives popup close because the snapshot lives
// in chrome.storage.local (written by the background on apply).
export function useSmartOrganizeUndo() {
    const [snapshot, setSnapshot] = useState(null);
    const loaded = useRef(false);

    useEffect(() => {
        browser.storage.local.get(KEY).then((items) => {
            if (!loaded.current) {
                setSnapshot(items[KEY] || null);
                loaded.current = true;
            }
        }).catch(() => {});

        const onChanged = (changes) => {
            if (changes[KEY]) {
                loaded.current = true;
                setSnapshot(changes[KEY].newValue || null);
            }
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => browser.storage.onChanged.removeListener(onChanged);
    }, []);

    const undo = useCallback(async () => {
        const windowId = snapshot?.windowId;
        return browser.runtime.sendMessage({ type: 'smartOrganizeUndo', windowId });
    }, [snapshot]);

    const dismiss = useCallback(async () => {
        await browser.storage.local.remove(KEY);
    }, []);

    return { snapshot, undo, dismiss };
}
