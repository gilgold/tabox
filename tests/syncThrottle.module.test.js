const { createSyncThrottle } = require('../chrome/sync-throttle.js');

// A deferred promise whose resolution we control, used to model an in-flight
// sync operation without relying on timers (Manifest V3 service workers can be
// torn down before a standalone setTimeout fires).
const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const flushMicrotasks = () => Promise.resolve();

describe('sync throttle module', () => {
    test('runs the first operation immediately (leading edge)', async () => {
        const throttle = createSyncThrottle();
        const operation = jest.fn().mockResolvedValue('ok');

        const result = await throttle(operation);

        expect(operation).toHaveBeenCalledTimes(1);
        expect(result).toBe('ok');
    });

    test('runs a queued trailing operation as soon as the in-flight one finishes (no timer)', async () => {
        const throttle = createSyncThrottle();
        const inFlight = createDeferred();
        const leading = jest.fn().mockReturnValue(inFlight.promise);
        const trailing = jest.fn().mockResolvedValue('trailing');

        const leadingResult = throttle(leading);
        // Second request arrives while the leading operation is still running.
        const trailingResult = throttle(trailing);

        // Trailing is queued, not run while the leading op is in flight.
        expect(trailing).toHaveBeenCalledTimes(0);

        // Finish the in-flight operation - the trailing run should fire on its own.
        inFlight.resolve('leading');
        await leadingResult;
        await flushMicrotasks();

        expect(trailing).toHaveBeenCalledTimes(1);
        await expect(trailingResult).resolves.toBe('trailing');
    });

    test('a throttled caller awaits its trailing run rather than getting a dropped/false result', async () => {
        const throttle = createSyncThrottle();
        const inFlight = createDeferred();

        const leadingResult = throttle(jest.fn().mockReturnValue(inFlight.promise));
        const throttledResult = throttle(jest.fn().mockResolvedValue('synced'));

        inFlight.resolve('leading');
        await leadingResult;

        await expect(throttledResult).resolves.toBe('synced');
    });

    test('coalesces multiple calls during a run into a single trailing run using the latest operation', async () => {
        const throttle = createSyncThrottle();
        const inFlight = createDeferred();
        const leading = jest.fn().mockReturnValue(inFlight.promise);
        const stale = jest.fn().mockResolvedValue('stale');
        const latest = jest.fn().mockResolvedValue('latest');

        const leadingResult = throttle(leading);
        throttle(stale);
        throttle(latest);

        inFlight.resolve('leading');
        await leadingResult;
        await flushMicrotasks();

        expect(stale).toHaveBeenCalledTimes(0);
        expect(latest).toHaveBeenCalledTimes(1);
    });

    test('runs immediately again once the queue has drained', async () => {
        const throttle = createSyncThrottle();

        await throttle(jest.fn().mockResolvedValue('first'));
        await flushMicrotasks();

        const second = jest.fn().mockResolvedValue('second');
        const result = await throttle(second);

        expect(second).toHaveBeenCalledTimes(1);
        expect(result).toBe('second');
    });

    test('keeps draining trailing operations queued during an earlier trailing run', async () => {
        const throttle = createSyncThrottle();
        const inFlight = createDeferred();
        const trailingInFlight = createDeferred();

        const leadingResult = throttle(jest.fn().mockReturnValue(inFlight.promise));
        const firstTrailing = jest.fn().mockReturnValue(trailingInFlight.promise);
        throttle(firstTrailing);

        // Finish the leading op so the first trailing run starts.
        inFlight.resolve('leading');
        await leadingResult;
        await flushMicrotasks();
        expect(firstTrailing).toHaveBeenCalledTimes(1);

        // A new request arrives while the first trailing run is in flight.
        const secondTrailing = jest.fn().mockResolvedValue('second-trailing');
        const secondResult = throttle(secondTrailing);
        expect(secondTrailing).toHaveBeenCalledTimes(0);

        // Finish the first trailing run - the second trailing run should follow.
        trailingInFlight.resolve('first-trailing');

        await expect(secondResult).resolves.toBe('second-trailing');
        expect(secondTrailing).toHaveBeenCalledTimes(1);
    });
});
