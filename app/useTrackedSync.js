import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { syncInProgressState } from './atoms/globalAppSettingsState';
import { triggerBackgroundSync } from './utils/sharedSync';

/**
 * Returns a function that runs a background sync while reflecting the shared
 * "Syncing..." indicator (the same atom App._update toggles). Use it for
 * operations that trigger their own sync (e.g. folder delete) so the user sees
 * the syncing state and can be shown a success toast immediately, before the
 * (multi-second) sync round-trip resolves.
 */
export function useTrackedSync() {
    const setSyncInProgress = useSetAtom(syncInProgressState);

    return useCallback(async (options) => {
        setSyncInProgress(true);
        try {
            return await triggerBackgroundSync(options);
        } finally {
            setSyncInProgress(false);
        }
    }, [setSyncInProgress]);
}
