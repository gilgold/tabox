import {
    unwrapDeferredUrl,
    isDeferredLoadingUrl,
    getCollectionUrls,
    buildCollectionUrlList,
    buildFolderUrlList,
} from '../app/utils/urlUtils.js';

const EXT = 'chrome-extension://bdbliblipiempfdkkkjohnecmeknnpoa/deferedLoading.html';

const legacyWrapper = (realUrl, favicon = '') =>
    `${EXT}?url=${encodeURIComponent(realUrl)}&favicon=${encodeURIComponent(favicon)}`;

const hashWrapper = (realUrl, favicon = '') =>
    `${EXT}#${encodeURIComponent(JSON.stringify({ url: realUrl, favicon }))}`;

describe('isDeferredLoadingUrl', () => {
    test('detects deferred wrapper URLs in both formats', () => {
        expect(isDeferredLoadingUrl(legacyWrapper('https://example.com'))).toBe(true);
        expect(isDeferredLoadingUrl(hashWrapper('https://example.com'))).toBe(true);
    });

    test('returns false for plain URLs and non-strings', () => {
        expect(isDeferredLoadingUrl('https://example.com')).toBe(false);
        expect(isDeferredLoadingUrl('')).toBe(false);
        expect(isDeferredLoadingUrl(null)).toBe(false);
        expect(isDeferredLoadingUrl(undefined)).toBe(false);
        expect(isDeferredLoadingUrl(42)).toBe(false);
    });
});

describe('unwrapDeferredUrl', () => {
    test('unwraps the legacy ?url= query format', () => {
        expect(unwrapDeferredUrl(legacyWrapper('https://example.com/docs')))
            .toBe('https://example.com/docs');
    });

    test('preserves a nested query string in the real URL (legacy format)', () => {
        const real = 'https://example.com/path?a=1&b=2';
        expect(unwrapDeferredUrl(legacyWrapper(real))).toBe(real);
    });

    test('unwraps the current #json hash format', () => {
        expect(unwrapDeferredUrl(hashWrapper('https://example.com/docs')))
            .toBe('https://example.com/docs');
    });

    test('passes through a URL that is not a deferred wrapper', () => {
        expect(unwrapDeferredUrl('https://example.com')).toBe('https://example.com');
    });

    test('passes through non-string input unchanged', () => {
        expect(unwrapDeferredUrl(null)).toBeNull();
        expect(unwrapDeferredUrl(undefined)).toBeUndefined();
        const obj = {};
        expect(unwrapDeferredUrl(obj)).toBe(obj);
    });

    test('returns the original string when the hash payload is malformed', () => {
        const malformed = `${EXT}#not-valid-json`;
        expect(unwrapDeferredUrl(malformed)).toBe(malformed);
    });

    test('returns the original string when no url is encoded', () => {
        const noUrl = `${EXT}?favicon=${encodeURIComponent('https://x/y.ico')}`;
        expect(unwrapDeferredUrl(noUrl)).toBe(noUrl);
    });
});

describe('getCollectionUrls', () => {
    test('passes plain URLs through unchanged', () => {
        const collection = {
            tabs: [
                { url: 'https://example.com/a' },
                { url: 'https://example.com/b' },
            ],
        };
        expect(getCollectionUrls(collection)).toEqual([
            'https://example.com/a',
            'https://example.com/b',
        ]);
    });

    test('unwraps deferred wrapper URLs in both formats', () => {
        const collection = {
            tabs: [
                { url: legacyWrapper('https://example.com/legacy') },
                { url: hashWrapper('https://example.com/hash') },
            ],
        };
        expect(getCollectionUrls(collection)).toEqual([
            'https://example.com/legacy',
            'https://example.com/hash',
        ]);
    });

    test('drops falsy / empty URLs', () => {
        const collection = {
            tabs: [
                { url: 'https://example.com/a' },
                { url: '' },
                { url: undefined },
                {},
                { url: 'https://example.com/b' },
            ],
        };
        expect(getCollectionUrls(collection)).toEqual([
            'https://example.com/a',
            'https://example.com/b',
        ]);
    });

    test('treats a collection with no tabs as empty', () => {
        expect(getCollectionUrls({})).toEqual([]);
        expect(getCollectionUrls({ tabs: undefined })).toEqual([]);
        expect(getCollectionUrls(null)).toEqual([]);
        expect(getCollectionUrls(undefined)).toEqual([]);
    });
});

describe('buildCollectionUrlList', () => {
    test('joins collection URLs with newlines', () => {
        const collection = {
            tabs: [
                { url: 'https://example.com/a' },
                { url: 'https://example.com/b' },
            ],
        };
        expect(buildCollectionUrlList(collection)).toBe(
            'https://example.com/a\nhttps://example.com/b'
        );
    });

    test('unwraps deferred URLs before joining', () => {
        const collection = {
            tabs: [
                { url: hashWrapper('https://example.com/hash') },
                { url: 'https://example.com/plain' },
            ],
        };
        expect(buildCollectionUrlList(collection)).toBe(
            'https://example.com/hash\nhttps://example.com/plain'
        );
    });

    test('returns an empty string for a collection with no tabs', () => {
        expect(buildCollectionUrlList({})).toBe('');
    });
});

describe('buildFolderUrlList', () => {
    test('formats folder name, collection headers, and unwrapped URLs', () => {
        const folder = { name: 'My Folder' };
        const collections = [
            {
                name: 'Collection One',
                tabs: [
                    { url: 'https://url1.com' },
                    { url: hashWrapper('https://url2.com') },
                ],
            },
            {
                name: 'Collection Two',
                tabs: [{ url: legacyWrapper('https://url3.com') }],
            },
        ];
        expect(buildFolderUrlList(folder, collections)).toBe(
            [
                'My Folder',
                '',
                'Collection One',
                'https://url1.com',
                'https://url2.com',
                '',
                'Collection Two',
                'https://url3.com',
            ].join('\n')
        );
    });

    test('folder name is the first line', () => {
        const result = buildFolderUrlList({ name: 'Top Folder' }, []);
        expect(result.split('\n')[0]).toBe('Top Folder');
    });

    test('an empty collection still shows its name header', () => {
        const folder = { name: 'Folder' };
        const collections = [
            { name: 'Has URLs', tabs: [{ url: 'https://has.com' }] },
            { name: 'Empty Collection', tabs: [] },
        ];
        const result = buildFolderUrlList(folder, collections);
        expect(result).toContain('Empty Collection');
        expect(result).toBe(
            [
                'Folder',
                '',
                'Has URLs',
                'https://has.com',
                '',
                'Empty Collection',
            ].join('\n')
        );
    });

    test('includes every collection name', () => {
        const collections = [
            { name: 'Alpha', tabs: [{ url: 'https://a.com' }] },
            { name: 'Beta', tabs: [] },
            { name: 'Gamma', tabs: [{ url: 'https://g.com' }] },
        ];
        const result = buildFolderUrlList({ name: 'F' }, collections);
        expect(result).toContain('Alpha');
        expect(result).toContain('Beta');
        expect(result).toContain('Gamma');
    });
});
