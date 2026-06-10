/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrphanRecoveryContext } from '../app/OrphanRecoveryContext';
import SyncDebugRecoveryPanel from '../app/SyncDebugRecoveryPanel';

jest.mock('../static/globals', () => ({
    browser: { runtime: { sendMessage: jest.fn().mockResolvedValue({ groups: [] }) } },
}));

const makeRecovery = (overrides = {}) => ({
    orphans: [{ uid: 'a', name: 'Alpha', tabCount: 2, color: 'red' }],
    orphanCount: 1,
    showEntry: true,
    showModal: false,
    busy: false,
    recover: jest.fn().mockResolvedValue({ success: true, recovered: 1 }),
    dismiss: jest.fn(),
    ...overrides,
});

const renderPanel = (recovery) => render(
    <OrphanRecoveryContext.Provider value={recovery}>
        <SyncDebugRecoveryPanel isActive mode="recovery" />
    </OrphanRecoveryContext.Provider>,
);

test('shows the orphan card with the count and restores via the picker', async () => {
    const recovery = makeRecovery();
    renderPanel(recovery);

    expect(await screen.findByText(/hidden collections found/i)).toBeInTheDocument();
    expect(screen.getByText(/1 recoverable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /review & restore/i }));

    // picker opens with the orphan preselected; confirm restore
    const confirmBtn = await screen.findByRole('button', { name: /restore .*selected/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(recovery.recover).toHaveBeenCalledWith(['a']));
});

test('hides the card when there are no orphans', () => {
    renderPanel(makeRecovery({ orphans: [], orphanCount: 0, showEntry: false }));
    expect(screen.queryByText(/hidden collections found/i)).not.toBeInTheDocument();
});
