/** @jest-environment jsdom */
import '@testing-library/jest-dom';

describe('deferedLoading', () => {
    const setupDocument = () => {
        document.head.innerHTML = '<link rel="icon" href="about:blank" />';
        document.body.innerHTML = `
            <div class="defer-container"></div>
            <a id="redirect-button" href="#"></a>
        `;
        window.history.replaceState(
            {},
            '',
            '/deferedLoading.html?url=https%3A%2F%2Fexample.com%2Fdocs&favicon=https%3A%2F%2Fexample.com%2Ffavicon.ico',
        );
    };

    beforeEach(() => {
        jest.resetModules();
        setupDocument();
    });

    test('sanitizes allowed urls and extracts query params', () => {
        let deferedLoading;

        jest.isolateModules(() => {
            deferedLoading = require('../static/deferedLoading');
        });

        expect(deferedLoading.sanitizeUrl('https%3A%2F%2Fexample.com%2Fsafe')).toBe('https://example.com/safe');
        expect(deferedLoading.sanitizeUrl('javascript:alert(1)')).toBe('#');
        expect(deferedLoading.extractUrlParams('https://tabox.test/?url=https%3A%2F%2Fexample.com')).toEqual({
            url: 'https://example.com',
        });
    });

    test('initializes the page title, favicon, and manual redirect button', () => {
        let deferedLoading;

        jest.isolateModules(() => {
            deferedLoading = require('../static/deferedLoading');
        });

        const replace = jest.fn();
        const logger = {
            error: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
        };
        const fakeLink = { href: 'about:blank' };
        let clickHandler = null;
        const fakeButton = {
            href: '#',
            addEventListener: jest.fn((eventName, handler) => {
                if (eventName === 'click') {
                    clickHandler = handler;
                }
            }),
        };
        const fakeDoc = {
            body: { innerHTML: '' },
            hidden: false,
            title: '',
            addEventListener: jest.fn(),
            querySelector: jest.fn((selector) => (
                selector === "link[rel~='icon']" ? fakeLink : null
            )),
            getElementById: jest.fn(() => fakeButton),
        };
        const fakeWin = {
            location: {
                href: 'https://tabox.test/deferedLoading.html?url=https%3A%2F%2Fexample.com%2Fdocs&favicon=https%3A%2F%2Fexample.com%2Ffavicon.ico',
                replace,
            },
            addEventListener: jest.fn(),
        };

        deferedLoading.initializeDeferredLoading({
            win: fakeWin,
            doc: fakeDoc,
            logger,
        });

        expect(fakeDoc.title).toBe('example.com (click to load)');
        expect(fakeLink.href).toBe('https://example.com/favicon.ico');
        expect(fakeButton.href).toBe('https://example.com/docs');

        clickHandler({ preventDefault: jest.fn() });

        expect(replace).toHaveBeenCalledWith('https://example.com/docs');
    });

    test('renders an error state for invalid urls', () => {
        let deferedLoading;

        jest.isolateModules(() => {
            deferedLoading = require('../static/deferedLoading');
        });

        const logger = {
            error: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
        };
        const fakeDoc = {
            body: { innerHTML: '' },
            hidden: false,
            title: '',
            addEventListener: jest.fn(),
            querySelector: jest.fn(() => null),
            getElementById: jest.fn(() => null),
        };
        const fakeWin = {
            location: { href: 'https://tabox.test/deferedLoading.html?url=javascript%3Aalert(1)' },
            addEventListener: jest.fn(),
        };

        expect(() => deferedLoading.initializeDeferredLoading({
            win: fakeWin,
            doc: fakeDoc,
            logger,
        })).toThrow('Invalid URL - stopping execution');

        expect(logger.error).toHaveBeenCalledWith('Invalid or missing URL parameter');
        expect(fakeDoc.body.innerHTML).toContain('Error Loading Content');
    });

    test('falls back to a manual redirect link when all redirect methods fail', () => {
        let deferedLoading;

        jest.isolateModules(() => {
            deferedLoading = require('../static/deferedLoading');
        });

        const logger = {
            error: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
        };
        const fakeContainer = { innerHTML: '' };
        const fakeDoc = {
            body: { innerHTML: '' },
            hidden: false,
            title: '',
            addEventListener: jest.fn(),
            querySelector: jest.fn(() => fakeContainer),
            getElementById: jest.fn(() => null),
        };
        const fakeLocation = {
            replace: jest.fn(() => {
                throw new Error('replace failed');
            }),
            get href() {
                return 'https://tabox.test/deferedLoading.html?url=https%3A%2F%2Fexample.com';
            },
            set href(_value) {
                throw new Error('href assignment failed');
            },
        };
        const fakeWin = {
            location: fakeLocation,
            addEventListener: jest.fn(),
        };

        const result = deferedLoading.initializeDeferredLoading({
            win: fakeWin,
            doc: fakeDoc,
            logger,
        });

        result.safeRedirect('https://example.com');

        expect(logger.warn).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('All redirect methods failed:', expect.any(Error));
        expect(fakeContainer.innerHTML).toContain('Go to Page');
    });
});
