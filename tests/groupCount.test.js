import { countNonEmptyGroups } from '../app/utils/groupCount';

describe('countNonEmptyGroups', () => {
  test('returns 0 when there are no groups', () => {
    expect(countNonEmptyGroups({ tabs: [{ uid: 't1' }], chromeGroups: [] })).toBe(0);
    expect(countNonEmptyGroups({ tabs: [{ uid: 't1' }] })).toBe(0);
    expect(countNonEmptyGroups(null)).toBe(0);
    expect(countNonEmptyGroups(undefined)).toBe(0);
  });

  test('counts only groups that have at least one tab referencing them', () => {
    const collection = {
      tabs: [
        { uid: 't1', groupUid: 'g1' },
        { uid: 't2', groupUid: 'g1' },
        { uid: 't3' }, // ungrouped
      ],
      chromeGroups: [{ uid: 'g1' }, { uid: 'g2' }, { uid: 'g3' }],
    };
    // g2 and g3 are orphaned (no tabs) -> should not be counted
    expect(countNonEmptyGroups(collection)).toBe(1);
  });

  test('regression: 2 tabs in 1 group with 5 extra orphaned groups counts as 1', () => {
    const collection = {
      tabs: [
        { uid: 't1', groupUid: 'g1' },
        { uid: 't2', groupUid: 'g1' },
      ],
      chromeGroups: [
        { uid: 'g1' }, { uid: 'g2' }, { uid: 'g3' },
        { uid: 'g4' }, { uid: 'g5' }, { uid: 'g6' },
      ],
    };
    expect(countNonEmptyGroups(collection)).toBe(1);
  });

  test('counts multiple non-empty groups', () => {
    const collection = {
      tabs: [
        { uid: 't1', groupUid: 'g1' },
        { uid: 't2', groupUid: 'g2' },
        { uid: 't3', groupUid: 'g2' },
      ],
      chromeGroups: [{ uid: 'g1' }, { uid: 'g2' }, { uid: 'g3' }],
    };
    expect(countNonEmptyGroups(collection)).toBe(2);
  });

  test('ignores tabs whose groupUid has no matching group object', () => {
    const collection = {
      tabs: [{ uid: 't1', groupUid: 'ghost' }],
      chromeGroups: [{ uid: 'g1' }],
    };
    expect(countNonEmptyGroups(collection)).toBe(0);
  });
});
