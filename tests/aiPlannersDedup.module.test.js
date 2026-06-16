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
  expect(group.collectionUids).toContain(out.recommendedKeeperUid);
  expect(out.message.length).toBeGreaterThan(0); // templated fallback
});
