const { DEDUP_SCHEMA, buildDedupPrompt, normalizeDedupSuggestion } = require('../chrome/ai-planners.js');

const group = {
  kind: 'cross',
  collectionUids: ['A', 'B', 'D'],
  urls: [
    { normalizedUrl: 'x.com/', occurrences: [
      { collectionUid: 'A', title: 'X' }, { collectionUid: 'B', title: 'X site' }, { collectionUid: 'D', title: 'X home' },
    ] },
  ],
};
const names = { A: 'Work', B: 'Read Later', D: 'Reference' };

test('DEDUP_SCHEMA requires keeper + message', () => {
  expect(DEDUP_SCHEMA.required).toEqual(expect.arrayContaining(['recommendedKeeper', 'message']));
});

test('buildDedupPrompt lists collections and the shared url titles', () => {
  const p = buildDedupPrompt(group, names);
  expect(p).toContain('Work');
  expect(p).toContain('Reference');
  expect(p).toContain('x.com/');
});

test('normalizeDedupSuggestion maps 1-based keeper index to uid and url titles', () => {
  const out = normalizeDedupSuggestion(
    { recommendedKeeper: 3, message: 'Keep in Reference.', suggestedNewCollectionName: 'Shared X', titles: [{ urlIndex: 1, title: 'Best X' }] },
    group,
  );
  expect(out.recommendedKeeperUid).toBe('D');
  expect(out.message).toBe('Keep in Reference.');
  expect(out.suggestedNewCollectionName).toBe('Shared X');
  expect(out.bestTitlePerUrl).toEqual([{ normalizedUrl: 'x.com/', title: 'Best X' }]);
});

test('normalizeDedupSuggestion falls back when keeper index is invalid', () => {
  const out = normalizeDedupSuggestion({ recommendedKeeper: 99, message: '' }, group);
  expect(out.recommendedKeeperUid).toBe('A');
  expect(out.message.length).toBeGreaterThan(0); // templated fallback
});

test('normalizeDedupSuggestion fallback message uses collection names when provided', () => {
  const out = normalizeDedupSuggestion({ recommendedKeeper: 1 }, group, names);
  expect(out.message).toContain('Work');
  expect(out.message).not.toMatch(/\bA, B, D\b/);
});

describe('dedup AI-skip helpers', () => {
  const { dedupGroupHasTitleConflict, buildDeterministicDedupSuggestion } = require('../chrome/ai-planners.js');

  const groupSameTitles = {
    collectionUids: ['A', 'D'],
    urls: [{ normalizedUrl: 'x.com/', occurrences: [
      { collectionUid: 'A', title: 'X' }, { collectionUid: 'D', title: 'X' },
    ] }],
  };
  const groupDiffTitles = {
    collectionUids: ['A', 'D'],
    urls: [{ normalizedUrl: 'x.com/', occurrences: [
      { collectionUid: 'A', title: 'X' }, { collectionUid: 'D', title: 'X Home' },
    ] }],
  };

  test('dedupGroupHasTitleConflict is false when all copies share a title (case/space-insensitive)', () => {
    expect(dedupGroupHasTitleConflict(groupSameTitles)).toBe(false);
    expect(dedupGroupHasTitleConflict({ collectionUids: ['A', 'D'], urls: [{ normalizedUrl: 'x', occurrences: [
      { collectionUid: 'A', title: ' X ' }, { collectionUid: 'D', title: 'x' },
    ] }] })).toBe(false);
  });

  test('dedupGroupHasTitleConflict is true when titles differ', () => {
    expect(dedupGroupHasTitleConflict(groupDiffTitles)).toBe(true);
  });

  test('empty titles are ignored (not counted as a conflict)', () => {
    expect(dedupGroupHasTitleConflict({ collectionUids: ['A', 'D'], urls: [{ normalizedUrl: 'x', occurrences: [
      { collectionUid: 'A', title: 'X' }, { collectionUid: 'D', title: '' },
    ] }] })).toBe(false);
  });

  test('buildDeterministicDedupSuggestion uses the keeper and reads naturally', () => {
    const out = buildDeterministicDedupSuggestion(groupSameTitles, { A: 'Work', D: 'Reference' }, 'D');
    expect(out.recommendedKeeperUid).toBe('D');
    expect(out.message).toContain('Work and Reference');
    expect(out.message).toContain('keeping them in Reference only');
    expect(out.bestTitlePerUrl).toEqual([]);
  });

  test('buildDeterministicDedupSuggestion falls back to first uid for an invalid keeper', () => {
    const out = buildDeterministicDedupSuggestion(groupSameTitles, { A: 'Work', D: 'Reference' }, 'ZZZ');
    expect(out.recommendedKeeperUid).toBe('A');
  });
});
