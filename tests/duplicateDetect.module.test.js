const { normalizeUrlForDedup, detectDuplicateGroups } = require('../chrome/duplicate-detect.js');

describe('normalizeUrlForDedup', () => {
  test('strips www, trailing slash, fragment; unifies scheme', () => {
    expect(normalizeUrlForDedup('https://www.example.com/a/')).toBe(normalizeUrlForDedup('http://example.com/a'));
    expect(normalizeUrlForDedup('https://example.com/a#section')).toBe(normalizeUrlForDedup('https://example.com/a'));
  });

  test('removes tracking params but keeps real ones, sorted', () => {
    expect(normalizeUrlForDedup('https://e.com/p?utm_source=x&id=2&a=1'))
      .toBe(normalizeUrlForDedup('https://e.com/p?a=1&id=2'));
  });

  test('falls back to raw trimmed string for unparseable urls', () => {
    expect(normalizeUrlForDedup('  chrome://extensions  ')).toBe('chrome://extensions');
    expect(normalizeUrlForDedup('not a url')).toBe('not a url');
  });

  test('sorts by key not insertion order', () => {
    expect(normalizeUrlForDedup('https://e.com/p?b=1&a=2')).toBe(normalizeUrlForDedup('https://e.com/p?a=2&b=1'));
  });

  test('does not collapse non-http(s) schemes together', () => {
    expect(normalizeUrlForDedup('ftp://example.com/f')).not.toBe(normalizeUrlForDedup('http://example.com/f'));
  });
});

describe('detectDuplicateGroups', () => {
  const mk = (uid, name, tabs) => ({ uid, name, tabs });

  test('buckets cross-collection dupes by the exact collection set', () => {
    const cols = [
      mk('A', 'A', [{ uid: 'a1', url: 'https://x.com/', title: 'X' }]),
      mk('B', 'B', [{ uid: 'b1', url: 'https://www.x.com', title: 'X site' }]),
      mk('D', 'D', [{ uid: 'd1', url: 'http://x.com/', title: 'X home' }]),
    ];
    const { groups } = detectDuplicateGroups(cols);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('cross');
    expect(groups[0].collectionUids.sort()).toEqual(['A', 'B', 'D']);
    expect(groups[0].urls[0].occurrences).toHaveLength(3);
  });

  test('records within-collection dupes as a within group with positions', () => {
    const cols = [mk('A', 'A', [
      { uid: 'a1', url: 'https://x.com/', title: 'X' },
      { uid: 'a2', url: 'https://other.com/', title: 'O' },
      { uid: 'a3', url: 'https://x.com', title: 'X again' },
    ])];
    const { groups } = detectDuplicateGroups(cols);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('within');
    expect(groups[0].collectionUids).toEqual(['A']);
    expect(groups[0].urls[0].occurrences.map((o) => o.position)).toEqual([0, 2]);
  });

  test('no duplicates -> empty', () => {
    expect(detectDuplicateGroups([mk('A', 'A', [{ uid: 'a1', url: 'https://x.com', title: 'X' }])]).groups).toEqual([]);
  });

  test('occurrences carry the full original tab object', () => {
    const cols = [
      mk('A', 'A', [{ uid: 'a1', url: 'https://x.com', title: 'X', pinned: true, favIconUrl: 'ic' }]),
      mk('B', 'B', [{ uid: 'b1', url: 'https://x.com', title: 'X2' }]),
    ];
    const occ = detectDuplicateGroups(cols).groups[0].urls[0].occurrences.find((o) => o.collectionUid === 'A');
    expect(occ.tab).toEqual({ uid: 'a1', url: 'https://x.com', title: 'X', pinned: true, favIconUrl: 'ic' });
  });
});
