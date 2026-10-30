import { isSupported } from '../app/utils/platform';

describe('resume auto-update UI capability', () => {
    test('requires alarm cleanup as well as creation', () => {
        const alarms = browser.alarms;
        const session = browser.storage.session;
        browser.alarms = { create: jest.fn(), clear: jest.fn() };
        browser.storage.session = { get: jest.fn(), set: jest.fn() };
        try {
            expect(isSupported('autoUpdateRecovery')).toBe(true);
            browser.alarms.clear = undefined;
            expect(isSupported('autoUpdateRecovery')).toBe(false);
        } finally {
            browser.alarms = alarms;
            browser.storage.session = session;
        }
    });
});
