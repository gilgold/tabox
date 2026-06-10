import { buildOrphanRecoveryMenuItem } from '../app/orphanRecoveryMenuItem';

test('returns null when there is nothing to recover', () => {
    expect(buildOrphanRecoveryMenuItem({ showEntry: false })).toBeNull();
    expect(buildOrphanRecoveryMenuItem()).toBeNull();
});

test('returns a button item whose onClick triggers recover (restore all)', () => {
    const recover = jest.fn();
    const item = buildOrphanRecoveryMenuItem({ showEntry: true, orphanCount: 3, recover });

    expect(item).toMatchObject({ type: 'button', key: 'recover-hidden' });
    expect(item.content).toMatch(/3 hidden collections/i);
    item.onClick();
    expect(recover).toHaveBeenCalledTimes(1);
});

test('onClick runs onActivate (e.g. close drawer) then recover, and tolerates a missing recover', () => {
    const calls = [];
    const onActivate = jest.fn(() => calls.push('activate'));
    const recover = jest.fn(() => calls.push('recover'));
    const item = buildOrphanRecoveryMenuItem({ showEntry: true, orphanCount: 2, recover }, { onActivate });

    item.onClick();
    expect(calls).toEqual(['activate', 'recover']);

    // No recover provided -> onClick must not throw.
    const item2 = buildOrphanRecoveryMenuItem({ showEntry: true, orphanCount: 2 }, { onActivate });
    expect(() => item2.onClick()).not.toThrow();
});

test('pluralizes correctly for a single collection', () => {
    const item = buildOrphanRecoveryMenuItem({ showEntry: true, orphanCount: 1, recover: () => {} });
    expect(item.content).toMatch(/1 hidden collection\b/i);
    expect(item.content).not.toMatch(/collections/i);
});
