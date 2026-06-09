/**
 * Build the popup "Backup & Restore" menu item that lets the user restore
 * collections an earlier update hid. Returns null when there is nothing to
 * recover. Pure (no React) so it is trivially unit-testable; the popup restores
 * all detected orphans (the selective picker lives in the full-page Recovery view).
 * @param {{ showEntry?: boolean, orphanCount?: number, recover?: Function }} [orphanRecovery]
 */
export const buildOrphanRecoveryMenuItem = (orphanRecovery = {}) => {
    if (!orphanRecovery || !orphanRecovery.showEntry) return null;
    const count = orphanRecovery.orphanCount || 0;
    const plural = count === 1 ? '' : 's';
    return {
        type: 'button',
        key: 'recover-hidden',
        title: 'Recover hidden collections',
        description: `${count} collection${plural} were hidden by an earlier update. Restore them to this device.`,
        onClick: () => orphanRecovery.recover(),
        content: `Restore ${count} hidden collection${plural}`,
    };
};
