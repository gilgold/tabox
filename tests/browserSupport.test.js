import { detectBrowserName } from '../app/ai/browserSupport';

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

describe('detectBrowserName', () => {
    test('identifies Brave via the navigator.brave global', () => {
        expect(detectBrowserName({ brave: { isBrave: () => {} }, userAgent: CHROME_UA })).toBe('Brave');
    });

    test('identifies Brave via userAgentData brands', () => {
        expect(detectBrowserName({
            userAgentData: { brands: [{ brand: 'Brave', version: '138' }, { brand: 'Chromium', version: '138' }] },
            userAgent: CHROME_UA,
        })).toBe('Brave');
    });

    test('identifies Edge via userAgentData brands', () => {
        expect(detectBrowserName({
            userAgentData: { brands: [{ brand: 'Microsoft Edge', version: '138' }, { brand: 'Chromium', version: '138' }] },
            userAgent: CHROME_UA,
        })).toBe('Microsoft Edge');
    });

    test('identifies Edge via the Edg/ userAgent token when brands are missing', () => {
        expect(detectBrowserName({ userAgent: `${CHROME_UA} Edg/138.0.0.0` })).toBe('Microsoft Edge');
    });

    test('identifies Opera via userAgentData brands', () => {
        expect(detectBrowserName({
            userAgentData: { brands: [{ brand: 'Opera', version: '120' }, { brand: 'Chromium', version: '138' }] },
            userAgent: CHROME_UA,
        })).toBe('Opera');
    });

    test('identifies Opera via the OPR/ userAgent token', () => {
        expect(detectBrowserName({ userAgent: `${CHROME_UA} OPR/120.0.0.0` })).toBe('Opera');
    });

    test('identifies Vivaldi via the userAgent token', () => {
        expect(detectBrowserName({ userAgent: `${CHROME_UA} Vivaldi/7.0` })).toBe('Vivaldi');
    });

    test('reports real Chrome as Google Chrome', () => {
        expect(detectBrowserName({
            userAgentData: { brands: [{ brand: 'Google Chrome', version: '138' }, { brand: 'Chromium', version: '138' }] },
            userAgent: CHROME_UA,
        })).toBe('Google Chrome');
    });

    test('fails open as Chrome for unidentified Chromium', () => {
        expect(detectBrowserName({ userAgent: CHROME_UA })).toBe('Google Chrome');
    });

    test('fails open as Chrome when navigator is missing', () => {
        expect(detectBrowserName(undefined)).toBe('Google Chrome');
    });
});
