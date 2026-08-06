// app/ai/useDuplicateSweep.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from '../../static/globals';

const KEY = 'duplicateSweep';

// Live view of the Duplicate-Tab Sweep state. Survives popup close because the
// state lives in chrome.storage.local (written by the SW). All mutations go
// through the SW via runtime messages.
export function useDuplicateSweep() {
    const [state, setState] = useState(null);
    const loaded = useRef(false);

    useEffect(() => {
        browser.storage.local.get(KEY).then((items) => {
            if (!loaded.current) { setState(items[KEY] || null); loaded.current = true; }
        }).catch(() => {});
        const onChanged = (changes, area) => {
            if (area !== 'local' || !changes[KEY]) return;
            loaded.current = true;
            setState(changes[KEY].newValue || null);
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => browser.storage.onChanged.removeListener(onChanged);
    }, []);

    const apply = useCallback(({ groupId, action, keeperUid, applyToAll }) =>
        browser.runtime.sendMessage({ type: 'duplicateSweepApply', groupId, action, keeperUid, applyToAll: !!applyToAll }), []);
    const undo = useCallback(() => browser.runtime.sendMessage({ type: 'duplicateSweepUndo' }), []);
    const dismiss = useCallback(() => browser.runtime.sendMessage({ type: 'duplicateSweepDismiss' }), []);
    const cleanupPreview = useCallback(() => browser.runtime.sendMessage({ type: 'duplicateSweepCleanupPreview' }), []);
    const cleanup = useCallback(({ collectionUids, folderUids }) =>
        browser.runtime.sendMessage({ type: 'duplicateSweepCleanup', collectionUids, folderUids }), []);

    return { state, apply, undo, dismiss, cleanupPreview, cleanup };
}
