/** @jest-environment jsdom */
import '@testing-library/jest-dom';
jest.mock('react-tooltip/dist/react-tooltip.css', () => ({}), { virtual: true });

const {
    DEFAULT_SYNC_SESSION_STATE,
    escapeSearchRegex,
    matchesCollectionSearch,
    markPerformancePoint,
    measurePerformanceSegment,
    logPerformanceSummary,
    shouldAutoLogPerformance,
    normalizeSyncSessionState,
    isSyncSessionEnabled,
    runWhenIdle,
    hasSessionMigrationCheck,
    markSessionMigrationComplete,
    shouldExposeDebugUtilities,
} = require('../app/App');

describe('App helper exports', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalPerformance = global.performance;
    const originalRequestIdleCallback = window.requestIdleCallback;

    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        process.env.NODE_ENV = originalEnv;
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        Object.defineProperty(global, 'performance', {
            configurable: true,
            value: originalPerformance,
        });
        window.requestIdleCallback = originalRequestIdleCallback;
        jest.restoreAllMocks();
    });

    test('escapes regex characters and matches collection names, titles, and urls', () => {
        expect(escapeSearchRegex('a+b?c')).toBe('a\\+b\\?c');

        const collection = {
            name: 'OpenAI Docs',
            tabs: [
                { title: 'Platform Guide', url: 'https://platform.openai.com/docs' },
            ],
        };

        expect(matchesCollectionSearch(collection, 'OpenAI')).toBe(true);
        expect(matchesCollectionSearch(collection, 'Guide')).toBe(true);
        expect(matchesCollectionSearch(collection, 'platform.openai.com')).toBe(true);
        expect(matchesCollectionSearch(collection, 'missing term')).toBe(false);
        expect(matchesCollectionSearch(collection, '')).toBe(true);
    });

    test('normalizes sync session state and reports when sync is enabled', () => {
        expect(DEFAULT_SYNC_SESSION_STATE.status).toBe('disabled');

        expect(normalizeSyncSessionState({
            status: 'active',
            user: { displayName: 'Test User' },
        })).toEqual(expect.objectContaining({
            isEnabled: false,
            status: 'active',
            user: { displayName: 'Test User' },
        }));

        expect(isSyncSessionEnabled({ isEnabled: true })).toBe(true);
        expect(isSyncSessionEnabled({ hasRefreshToken: true })).toBe(true);
        expect(isSyncSessionEnabled({ user: { email: 'tabox@example.com' } })).toBe(true);
        expect(isSyncSessionEnabled({})).toBe(false);
    });

    test('tracks the session migration flag in sessionStorage', () => {
        expect(hasSessionMigrationCheck()).toBe(false);

        markSessionMigrationComplete();

        expect(window.sessionStorage.getItem('tabox:migrationChecked')).toBe('1');
        expect(hasSessionMigrationCheck()).toBe(true);
    });

    test('uses debug flags for performance and debug utility exposure in production', () => {
        process.env.NODE_ENV = 'production';

        expect(shouldAutoLogPerformance()).toBe(false);
        expect(shouldExposeDebugUtilities()).toBe(false);

        window.localStorage.setItem('TABOX_DEBUG_PERF', '1');
        window.localStorage.setItem('TABOX_ENABLE_DEBUG_UTILS', '1');

        expect(shouldAutoLogPerformance()).toBe(true);
        expect(shouldExposeDebugUtilities()).toBe(true);
    });

    test('resolves idle work through requestIdleCallback when available', async () => {
        window.requestIdleCallback = jest.fn((callback) => callback());

        await expect(runWhenIdle()).resolves.toBeUndefined();
        expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
    });

    test('records and logs performance measurements when supported', () => {
        const mark = jest.fn();
        const measure = jest.fn(() => ({ name: 'tabox:popup:measure:load', duration: 12.34 }));
        const getEntriesByType = jest.fn(() => [
            { name: 'tabox:popup:measure:load', duration: 12.34 },
        ]);
        const groupCollapsed = jest.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
        const table = jest.spyOn(console, 'table').mockImplementation(() => {});
        const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {});

        Object.defineProperty(global, 'performance', {
            configurable: true,
            value: { mark, measure, getEntriesByType },
        });

        markPerformancePoint('start');
        const measurement = measurePerformanceSegment('load', 'start', 'end');
        logPerformanceSummary();

        expect(mark).toHaveBeenCalledWith('tabox:popup:start');
        expect(measure).toHaveBeenCalledWith('tabox:popup:measure:load', 'tabox:popup:start', 'tabox:popup:end');
        expect(measurement).toEqual({ name: 'tabox:popup:measure:load', duration: 12.34 });
        expect(groupCollapsed).toHaveBeenCalledWith('[Tabox] Popup performance summary');
        expect(table).toHaveBeenCalledWith([{ segment: 'load', duration: '12.34ms' }]);
        expect(groupEnd).toHaveBeenCalledTimes(1);
    });
});
