import { useCallback, useEffect, useState } from 'react';
import { browser } from '../static/globals';
import { detectRecoverableCollections, recoverOrphanedCollections } from './utils/orphanRecovery';

const DISMISS_KEY = 'orphanRecoveryModalDismissed';

/**
 * Single source of truth for orphaned-collection recovery across all surfaces.
 * @param {boolean} ready - run detection only once migration has finished
 * @param {{ onRecovered?: (count: number) => (void|Promise<void>) }} [options]
 */
export default function useOrphanRecovery(ready, { onRecovered } = {}) {
    const [orphans, setOrphans] = useState([]);
    const [dismissed, setDismissed] = useState(true); // suppress modal until detection confirms otherwise
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!ready) return undefined;
        let cancelled = false;
        (async () => {
            const found = await detectRecoverableCollections();
            const { [DISMISS_KEY]: flag } = await browser.storage.local.get(DISMISS_KEY);
            if (cancelled) return;
            setOrphans(found);
            setDismissed(Boolean(flag));
        })();
        return () => { cancelled = true; };
    }, [ready]);

    const recover = useCallback(async (uids) => {
        const target = (uids && uids.length) ? uids : orphans.map((o) => o.uid);
        if (target.length === 0) return { success: true, recovered: 0, uids: [] };
        setBusy(true);
        try {
            const result = await recoverOrphanedCollections(target);
            const remaining = await detectRecoverableCollections();
            setOrphans(remaining);
            if (result.success && result.recovered > 0 && typeof onRecovered === 'function') {
                await onRecovered(result.recovered);
            }
            return result;
        } finally {
            setBusy(false);
        }
    }, [orphans, onRecovered]);

    const dismiss = useCallback(async () => {
        await browser.storage.local.set({ [DISMISS_KEY]: true });
        setDismissed(true);
    }, []);

    return {
        orphans,
        orphanCount: orphans.length,
        showModal: orphans.length > 0 && !dismissed,
        showEntry: orphans.length > 0,
        busy,
        recover,
        dismiss,
    };
}
