/** @jest-environment jsdom */
import '@testing-library/jest-dom';

describe('deferedLoading', () => {
    const hashPayload = (url, favicon = '') =>
        encodeURIComponent(JSON.stringify({ url, favicon }));

    const setupDocument = () => {
        document.head.innerHTML = '<link rel="icon" href="about:blank" />';
        document.body.innerHTML = `
            <div class="defer-container"></div>
            <a id="redirect-button" href="#"></a>
        `;
        window.history.replaceState(
            {},
            '',
            `/deferedLoading.html#${hashPayload('https://example.com/docs', 'https://example.com/favicon.ico')}`,
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

        expect(deferedLoading.sanitizeUrl('https://example.com/safe')).toBe('https://example.com/safe');
        expect(deferedLoading.sanitizeUrl('javascript:alert(1)')).toBe('#');

        // Current format: payload encoded in the hash fragment.
        expect(deferedLoading.extractUrlParams(
            `https://tabox.test/deferedLoading.html#${hashPayload('https://example.com', 'https://example.com/favicon.ico')}`,
        )).toEqual({
            url: 'https://example.com',
            favicon: 'https://example.com/favicon.ico',
        });

        // Legacy format (<= v4.1): payload in the query string still parses.
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
                href: `https://tabox.test/deferedLoading.html#${hashPayload('https://example.com/docs', 'https://example.com/favicon.ico')}`,
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

    test('still loads tabs saved with the legacy query-string format', () => {
        let deferedLoading;

        jest.isolateModules(() => {
            deferedLoading = require('../static/deferedLoading');
        });

        const replace = jest.fn();
        const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
        const fakeLink = { href: 'about:blank' };
        let clickHandler = null;
        const fakeButton = {
            href: '#',
            addEventListener: jest.fn((eventName, handler) => {
                if (eventName === 'click') clickHandler = handler;
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

        deferedLoading.initializeDeferredLoading({ win: fakeWin, doc: fakeDoc, logger });

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

// ---------------------------------------------------------------------------
// Special-character / query-string handling and security (XSS) tests.
// ---------------------------------------------------------------------------

const silentLogger = () => ({ error: jest.fn(), warn: jest.fn(), log: jest.fn() });

const getHandler = (mockFn, eventName) => {
    const call = mockFn.mock.calls.find(([name]) => name === eventName);
    return call && call[1];
};

const makeFakeDoc = (overrides = {}) => ({
    body: { innerHTML: '' },
    hidden: false,
    title: '',
    addEventListener: jest.fn(),
    querySelector: jest.fn(() => null),
    getElementById: jest.fn(() => null),
    ...overrides,
});

const encodeHash = (payload) => encodeURIComponent(JSON.stringify(payload));

const loadModule = () => {
    let mod;
    jest.isolateModules(() => {
        mod = require('../static/deferedLoading');
    });
    return mod;
};

describe('deferedLoading - sanitizeUrl: valid URLs with special characters', () => {
    let deferedLoading;
    beforeEach(() => {
        // A valid hash so the module's auto-init on require does not throw.
        window.history.replaceState({}, '', `/deferedLoading.html#${encodeHash({ url: 'https://example.com/', favicon: '' })}`);
        document.head.innerHTML = '<link rel="icon" href="about:blank" />';
        document.body.innerHTML = '<div class="defer-container"></div><a id="redirect-button" href=""></a>';
        deferedLoading = loadModule();
    });

    test.each([
        ['query string with spaces and fragment', 'https://example.com/search?q=hello world&x=1#section'],
        ['percent-encoded reserved characters are preserved', 'https://example.com/path?q=a%26b&r=a%2Bb&s=%20'],
        ['unicode / IDN host and path', 'https://xn--r8jz45g.xn--zckzah/パス?q=値'],
        ['credentials and explicit port', 'https://user:pass@host.example.com:8443/p?x=1'],
        ['plain http localhost', 'http://localhost:3000/?a=1&b=2'],
        ['many query params', 'https://example.com/?a=1&b=2&c=3&d=4&e=5'],
    ])('preserves a valid URL exactly: %s', (_label, url) => {
        expect(deferedLoading.sanitizeUrl(url)).toBe(url);
    });

    test('does NOT corrupt encoded query separators (no double-decode)', () => {
        // %26 must NOT become a literal & (which would split into extra params),
        // and %2B must NOT become a space/+.
        const url = 'https://example.com/?redirect=https%3A%2F%2Fother.com%2F%3Fa%3D1%26b%3D2';
        expect(deferedLoading.sanitizeUrl(url)).toBe(url);
    });
});

describe('deferedLoading - sanitizeUrl: rejects dangerous / malformed input', () => {
    let deferedLoading;
    beforeEach(() => {
        window.history.replaceState({}, '', `/deferedLoading.html#${encodeHash({ url: 'https://example.com/', favicon: '' })}`);
        deferedLoading = loadModule();
    });

    test.each([
        ['javascript scheme', 'javascript:alert(1)'],
        ['mixed-case javascript scheme', 'JaVaScRiPt:alert(document.domain)'],
        ['javascript with leading/trailing spaces', '   javascript:alert(1)   '],
        ['javascript with embedded tab', 'java\tscript:alert(1)'],
        ['javascript with embedded newline', 'java\nscript:alert(1)'],
        ['javascript with embedded CR', 'java\rscript:alert(1)'],
        ['data url', 'data:text/html,<script>alert(1)</script>'],
        ['data url base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
        ['vbscript scheme', 'vbscript:msgbox(1)'],
        ['file scheme', 'file:///etc/passwd'],
        ['blob scheme', 'blob:https://example.com/uuid'],
        ['about scheme', 'about:blank'],
        ['chrome scheme', 'chrome://settings'],
        ['mailto scheme', 'mailto:victim@example.com'],
        ['percent-encoded javascript scheme', 'javascript%3Aalert(1)'],
        ['not a url at all', 'definitely not a url'],
        ['empty string', ''],
        ['literal undefined', 'undefined'],
        ['literal null', 'null'],
    ])('returns "#" for %s', (_label, input) => {
        expect(deferedLoading.sanitizeUrl(input)).toBe('#');
    });

    test.each([
        ['null', null],
        ['undefined', undefined],
        ['number', 12345],
        ['object', {}],
    ])('returns "#" for non-string input: %s', (_label, input) => {
        expect(deferedLoading.sanitizeUrl(input)).toBe('#');
    });
});

describe('deferedLoading - extractUrlParams: special characters', () => {
    let deferedLoading;
    beforeEach(() => {
        window.history.replaceState({}, '', `/deferedLoading.html#${encodeHash({ url: 'https://example.com/', favicon: '' })}`);
        deferedLoading = loadModule();
    });

    test('preserves query params, fragments and ampersands carried in the hash payload', () => {
        const url = 'https://example.com/s?q=a&b=c&d=e#frag';
        const href = `https://x/deferedLoading.html#${encodeHash({ url, favicon: '' })}`;
        expect(deferedLoading.extractUrlParams(href)).toEqual({ url, favicon: '' });
    });

    test('preserves percent-encoded reserved characters in the hash payload', () => {
        const url = 'https://example.com/?q=a%26b&r=a%2Bb';
        const href = `https://x/deferedLoading.html#${encodeHash({ url, favicon: '' })}`;
        expect(deferedLoading.extractUrlParams(href).url).toBe(url);
    });

    test('preserves unicode characters in the hash payload', () => {
        const url = 'https://example.com/パス?q=値';
        const href = `https://x/deferedLoading.html#${encodeHash({ url, favicon: '' })}`;
        expect(deferedLoading.extractUrlParams(href).url).toBe(url);
    });

    test('decodes a legacy query-string url that contains encoded reserved characters', () => {
        const url = 'https://example.com/?q=a%26b';
        const href = `https://x/deferedLoading.html?url=${encodeURIComponent(url)}&favicon=`;
        expect(deferedLoading.extractUrlParams(href)).toEqual({ url, favicon: '' });
    });

    test('falls back to (empty) query parsing when the hash payload is not valid JSON', () => {
        expect(deferedLoading.extractUrlParams('https://x/deferedLoading.html#not-json-at-all')).toEqual({});
    });

    test('does not throw on a non-object JSON hash payload', () => {
        const href = `https://x/deferedLoading.html#${encodeURIComponent(JSON.stringify([1, 2, 3]))}`;
        expect(() => deferedLoading.extractUrlParams(href)).not.toThrow();
    });

    test('a __proto__ payload does not pollute Object.prototype', () => {
        const href = `https://x/deferedLoading.html#${encodeURIComponent('{"__proto__":{"polluted":true}}')}`;
        deferedLoading.extractUrlParams(href);
        expect({}.polluted).toBeUndefined();
    });
});

describe('deferedLoading - security: no XSS via the manual redirect link', () => {
    let deferedLoading;
    beforeEach(() => {
        window.history.replaceState({}, '', `/deferedLoading.html#${encodeHash({ url: 'https://example.com/', favicon: '' })}`);
        document.head.innerHTML = '<link rel="icon" href="about:blank" />';
        document.body.innerHTML = '<div class="defer-container"></div>';
        deferedLoading = loadModule();
    });

    test.each([
        ['attribute breakout with img/onerror', 'https://evil.example.com/"><img src=x onerror="alert(1)">'],
        ['attribute breakout with script tag', 'https://evil.example.com/"><script>alert(1)</script>'],
        ["single-quote breakout", "https://evil.example.com/'><img src=x onerror=alert(1)>"],
    ])('does not inject markup into the page for %s', (_label, payload) => {
        // Real flow always passes a scheme-sanitized URL.
        const safeUrl = deferedLoading.sanitizeUrl(payload);
        deferedLoading.showManualRedirectOption(safeUrl, document);

        const container = document.querySelector('.defer-container');
        // The dangerous string must be treated as data, never parsed as HTML.
        expect(container.querySelectorAll('img').length).toBe(0);
        expect(container.querySelectorAll('script').length).toBe(0);
        // The legitimate link is still rendered.
        expect(container.textContent).toContain('Go to Page');
    });
});

describe('deferedLoading - security: initializeDeferredLoading hardening', () => {
    let deferedLoading;
    beforeEach(() => {
        window.history.replaceState({}, '', `/deferedLoading.html#${encodeHash({ url: 'https://example.com/', favicon: '' })}`);
        deferedLoading = loadModule();
    });

    test('rejects a javascript: payload: shows the error state and never wires a dangerous redirect', () => {
        const logger = silentLogger();
        const fakeWin = {
            location: {
                href: `https://x/deferedLoading.html#${encodeHash({ url: 'javascript:alert(1)', favicon: '' })}`,
                replace: jest.fn(),
            },
            addEventListener: jest.fn(),
        };
        const fakeDoc = makeFakeDoc();

        expect(() => deferedLoading.initializeDeferredLoading({ win: fakeWin, doc: fakeDoc, logger }))
            .toThrow('Invalid URL - stopping execution');
        expect(logger.error).toHaveBeenCalledWith('Invalid or missing URL parameter');
        expect(fakeWin.location.replace).not.toHaveBeenCalled();
    });

    test('focus redirect preserves a URL with encoded query separators (no corruption)', () => {
        const realUrl = 'https://example.com/?redirect=https%3A%2F%2Fother.com%2F%3Fa%3D1%26b%3D2&x=1';
        const replace = jest.fn();
        const fakeWin = {
            location: {
                href: `https://x/deferedLoading.html#${encodeHash({ url: realUrl, favicon: '' })}`,
                replace,
            },
            addEventListener: jest.fn(),
        };
        const fakeDoc = makeFakeDoc();

        deferedLoading.initializeDeferredLoading({ win: fakeWin, doc: fakeDoc, logger: silentLogger() });
        const focusHandler = getHandler(fakeWin.addEventListener, 'focus');
        focusHandler();

        expect(replace).toHaveBeenCalledWith(realUrl);
    });

    test('sets the Load Now button href via property without injecting markup', () => {
        const payload = 'https://evil.example.com/"><img src=x onerror=alert(1)>';
        document.head.innerHTML = '<link rel="icon" href="about:blank" />';
        document.body.innerHTML = '<div class="defer-container"></div><a id="redirect-button" href=""></a>';
        window.history.replaceState({}, '', `/deferedLoading.html#${encodeHash({ url: payload, favicon: '' })}`);

        deferedLoading.initializeDeferredLoading({ win: window, doc: document, logger: silentLogger() });

        // No element injection anywhere in the page from setting the button href.
        expect(document.querySelectorAll('img').length).toBe(0);
        expect(document.body.querySelectorAll('script').length).toBe(0);
        // Button href is set as data (scheme already validated as https).
        const button = document.getElementById('redirect-button');
        expect(button.getAttribute('href')).toContain('evil.example.com');
    });
});
