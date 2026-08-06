// app/ai/useAutoArrangeUndo.js
import { useCallback, useEffect, useState } from 'react';
import { browser } from '../../static/globals';

const AI_TASK_STATE_KEY = 'aiTaskState';
// Persistent "undo last arrange" affordance. The SW stores the undo snapshot in
// aiTaskState.undo (survives popup close). Undo is performed by the SW via the
// aiUndo message. Only a COMPLETED auto-arrange run is undoable.
export function useAutoArrangeUndo() {
    const [snapshot, setSnapshot] = useState(null);
    const derive = (st) => (st && st.type === 'auto-arrange' && st.status === 'done' && st.undo) ? st.undo : null;
    useEffect(() => {
        browser.runtime.sendMessage({ type: 'aiGetState' }).then((st) => setSnapshot(derive(st))).catch(() => {});
        const onChanged = (changes, area) => {
            if (area !== 'local') return;
            if (changes[AI_TASK_STATE_KEY]) setSnapshot(derive(changes[AI_TASK_STATE_KEY].newValue));
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => browser.storage.onChanged.removeListener(onChanged);
    }, []);
    const undo = useCallback(async () => { await browser.runtime.sendMessage({ type: 'aiUndo' }); }, []);
    return { snapshot, undo };
}
