const { buildDeterministicDedupSuggestion } = require('../chrome/ai-planners.js');

describe('deterministic dedup suggestion', () => {
  const groupSameTitles = {
    collectionUids: ['A', 'D'],
    urls: [{ normalizedUrl: 'x.com/', occurrences: [
      { collectionUid: 'A', title: 'X' }, { collectionUid: 'D', title: 'X' },
    ] }],
  };

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
