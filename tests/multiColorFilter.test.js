import { filterByColors } from '../app/utils/colorMigration';

const collections = [
  { uid: '1', color: 'red' },
  { uid: '2', color: 'blue' },
  { uid: '3', color: 'green' },
  { uid: '4', color: 'default' },
];

describe('filterByColors', () => {
  test('empty selection returns all collections', () => {
    expect(filterByColors(collections, [])).toHaveLength(4);
    expect(filterByColors(collections, undefined)).toHaveLength(4);
  });

  test('single color returns only matching collections', () => {
    const result = filterByColors(collections, ['red']);
    expect(result.map((c) => c.uid)).toEqual(['1']);
  });

  test('multiple colors return any matching collection (OR)', () => {
    const result = filterByColors(collections, ['red', 'blue']);
    expect(result.map((c) => c.uid)).toEqual(['1', '2']);
  });

  test('normalizes color keys when matching', () => {
    const legacy = [{ uid: 'x', color: '#DC2626' }];
    expect(filterByColors(legacy, ['red']).map((c) => c.uid)).toEqual(['x']);
  });
});
