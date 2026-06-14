// app/ai/useAutoArrangeUndo.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from '../../static/globals';
import { AUTO_ARRANGE_UNDO_KEY, undoAutoArrange } from './autoArrangeApply';

// Live view of the persistent auto-arrange undo snapshot. Drives the in-modal
// "Undo" button; survives popup close because the snapshot lives in
// chrome.storage.local (written by applyAutoArrange).
export function useAutoArrangeUndo() {
    const [snapshot, setSnapshot] = useState(null);
    const loaded = useRef(false);

    useEffect(() => {
        browser.storage.local.get(AUTO_ARRANGE_UNDO_KEY).then((items) => {
            if (!loaded.current) {
                setSnapshot(items[AUTO_ARRANGE_UNDO_KEY] || null);
                loaded.current = true;
            }
        }).catch(() => {});

        const onChanged = (changes) => {
            if (changes[AUTO_ARRANGE_UNDO_KEY]) {
                loaded.current = true;
                setSnapshot(changes[AUTO_ARRANGE_UNDO_KEY].newValue || null);
            }
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => browser.storage.onChanged.removeListener(onChanged);
    }, []);

    const undo = useCallback(async () => {
        if (!snapshot) return;
        await undoAutoArrange(snapshot);
    }, [snapshot]);

    return { snapshot, undo };
}
