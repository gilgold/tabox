(() => {
/**
 * Creates a coalescing throttle for sync operations.
 *
 * The first call runs immediately. Any call made while an operation is in
 * flight is coalesced into a single trailing run that fires as soon as the
 * current run finishes (using the most recent operation). Callers always await
 * the run that reflects their request, so the latest local state is guaranteed
 * to reach the remote even when two sync-triggering actions happen back to back
 * (e.g. duplicating a collection and immediately deleting the duplicate),
 * instead of being silently dropped.
 *
 * This intentionally avoids deferring work to a standalone timer: in a Manifest
 * V3 service worker a pending setTimeout can be discarded when the worker is
 * torn down (popup closed, worker idle), which would drop the queued sync. By
 * chaining the trailing run to the completion of the in-flight run and keeping
 * the triggering caller awaiting it, the work runs while the worker is still
 * alive.
 */
const createSyncThrottle = () => {
    let running = false;
    let pendingOperation = null;
    let pendingWaiters = [];

    const runAndDrain = (operation) => (
        Promise.resolve()
            .then(() => operation())
            .finally(() => {
                if (!pendingOperation) {
                    running = false;
                    return;
                }

                const nextOperation = pendingOperation;
                const waiters = pendingWaiters;
                pendingOperation = null;
                pendingWaiters = [];

                // running stays true: the trailing run keeps the throttle closed
                // so further calls coalesce into the next trailing run.
                runAndDrain(nextOperation).then(
                    (result) => waiters.forEach((waiter) => waiter.resolve(result)),
                    (error) => waiters.forEach((waiter) => waiter.reject(error))
                );
            })
    );

    const throttle = (operation) => {
        if (running) {
            // Coalesce: remember the latest operation and wait for its trailing run.
            pendingOperation = operation;
            return new Promise((resolve, reject) => {
                pendingWaiters.push({ resolve, reject });
            });
        }

        running = true;
        return runAndDrain(operation);
    };

    const isThrottling = () => running;

    const reset = () => {
        running = false;
        pendingOperation = null;
        pendingWaiters = [];
    };

    return Object.assign(throttle, { isThrottling, reset });
};

const syncThrottleApi = {
    createSyncThrottle
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') {
    globalThis.TaboxSyncThrottle = syncThrottleApi;
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncThrottleApi;
}
})();
