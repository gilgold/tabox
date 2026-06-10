/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SyncDebugRecoveryPanel from '../app/SyncDebugRecoveryPanel';
import { browser } from '../static/globals';
import { showSuccessToast } from '../app/toastHelpers';

jest.mock('../static/globals', () => ({
    browser: {
        runtime: {
            sendMessage: jest.fn(),
        },
    },
}));

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
}));

const fullBackupPayload = {
    type: 'full_export',
    folders: [{ uid: 'folder-1', name: 'Team', color: '#ff8a65' }],
    collections: [
        { uid: 'collection-1', name: 'Alpha', color: '#4fc3f7', parentId: 'folder-1', tabs: [], chromeGroups: [] },
        { uid: 'collection-2', name: 'Beta', color: '#aed581', parentId: null, tabs: [], chromeGroups: [] },
    ],
};

const mockRecoveryMessages = ({ groups, previewPayload = fullBackupPayload, logs = [] }) => {
    browser.runtime.sendMessage.mockImplementation(async (message) => {
        switch (message.type) {
            case 'getBackupOptions':
                return { groups };
            case 'getSyncLogs':
                return logs;
            case 'getBackupPreview':
                return {
                    kind: 'full_export',
                    payload: previewPayload,
                };
            case 'restoreBackupSelection':
                return { success: true };
            default:
                return undefined;
        }
    });
};

describe('SyncDebugRecoveryPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.confirm = jest.fn(() => true);
    });

    test('restores an entire backup from the row without expanding details', async () => {
        mockRecoveryMessages({
            groups: [
                {
                    key: 'auto',
                    title: 'Auto Backups',
                    items: [
                        {
                            id: 'auto:0',
                            source: 'auto',
                            timestamp: '2026-03-29T09:00:00.000Z',
                            collectionCount: 2,
                            folderCount: 1,
                            canPreview: true,
                            canSelectiveRestore: true,
                            canOverwrite: true,
                            previewType: 'full_export',
                        },
                    ],
                },
            ],
        });

        render(
            <SyncDebugRecoveryPanel
                isActive={true}
                isSyncEnabled={true}
                mode="recovery"
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
                onDataUpdate={jest.fn()}
            />,
        );

        expect(await screen.findByText('Auto Backups')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: /backup details/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Restore backup auto:0/i }));

        expect(global.confirm).toHaveBeenCalledWith(expect.stringMatching(/overwrite matching saved items/i));
        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'restoreBackupSelection',
                backupId: 'auto:0',
                mode: 'overwrite',
                payload: fullBackupPayload,
            });
        });
        expect(showSuccessToast).toHaveBeenCalledWith(
            'Backup restored by overwriting matching saved items',
            3000,
            { toasterId: undefined },
        );
    });

    test('opens a focused picker and restores only selected backup items', async () => {
        mockRecoveryMessages({
            groups: [
                {
                    key: 'auto',
                    title: 'Auto Backups',
                    items: [
                        {
                            id: 'auto:0',
                            source: 'auto',
                            timestamp: '2026-03-29T09:00:00.000Z',
                            collectionCount: 2,
                            folderCount: 1,
                            canPreview: true,
                            canSelectiveRestore: true,
                            canOverwrite: true,
                            previewType: 'full_export',
                        },
                    ],
                },
            ],
        });

        render(
            <SyncDebugRecoveryPanel
                isActive={true}
                isSyncEnabled={true}
                mode="recovery"
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
            />,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Choose items for backup auto:0/i }));

        const dialog = await screen.findByRole('dialog', { name: /Choose backup items/i });
        expect(await within(dialog).findByText('Team')).toBeInTheDocument();
        expect(within(dialog).getByText('No Folder')).toBeInTheDocument();
        expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
        expect(within(dialog).getByText('Beta')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Restore 2 selected' })).toBeInTheDocument();

        fireEvent.click(within(dialog).getByLabelText('Restore Beta'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore 1 selected' }));

        expect(global.confirm).toHaveBeenCalledWith(expect.stringMatching(/overwrite the selected backup items/i));
        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'restoreBackupSelection',
                backupId: 'auto:0',
                mode: 'overwrite',
                payload: {
                    type: 'full_export',
                    folders: [{ uid: 'folder-1', name: 'Team', color: '#ff8a65' }],
                    collections: [
                        { uid: 'collection-1', name: 'Alpha', color: '#4fc3f7', parentId: 'folder-1', tabs: [], chromeGroups: [] },
                    ],
                },
            });
        });
    });

    test('collapses picker folder sections into a single clean row', async () => {
        mockRecoveryMessages({
            groups: [
                {
                    key: 'auto',
                    title: 'Auto Backups',
                    items: [
                        {
                            id: 'auto:0',
                            source: 'auto',
                            timestamp: '2026-03-29T09:00:00.000Z',
                            collectionCount: 2,
                            folderCount: 1,
                            canPreview: true,
                            canSelectiveRestore: true,
                            canOverwrite: true,
                            previewType: 'full_export',
                        },
                    ],
                },
            ],
        });

        render(
            <SyncDebugRecoveryPanel
                isActive={true}
                isSyncEnabled={true}
                mode="recovery"
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
            />,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Choose items for backup auto:0/i }));

        const dialog = await screen.findByRole('dialog', { name: /Choose backup items/i });
        const teamToggle = await within(dialog).findByRole('button', { name: 'Toggle Team' });
        expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
        expect(teamToggle.closest('.sync-recovery-picker-section')).toHaveClass('is-folder-section');
        expect(within(dialog).getByRole('button', { name: 'Toggle No Folder' }).closest('.sync-recovery-picker-section')).toHaveClass('is-root-section');

        fireEvent.click(teamToggle);

        expect(teamToggle.closest('.sync-recovery-picker-section')).toHaveClass('is-collapsed');
        expect(within(dialog).queryByText('Alpha')).not.toBeInTheDocument();
        expect(within(dialog).getByText('Team')).toBeInTheDocument();
    });

    test('shows metadata-only backups but disables restore actions', async () => {
        mockRecoveryMessages({
            groups: [
                {
                    key: 'preSync',
                    title: 'Pre-Sync Backups',
                    items: [
                        {
                            id: 'preSync:0',
                            source: 'preSync',
                            timestamp: '2026-03-30T10:00:00.000Z',
                            collectionCount: 1,
                            folderCount: 0,
                            canPreview: true,
                            canSelectiveRestore: false,
                            canOverwrite: false,
                            previewType: 'metadata_only',
                        },
                    ],
                },
            ],
        });

        render(
            <SyncDebugRecoveryPanel
                isActive={true}
                isSyncEnabled={true}
                mode="recovery"
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
            />,
        );

        expect(await screen.findByText('Pre-Sync Backups')).toBeInTheDocument();
        expect(screen.getByText('Limited metadata only')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Restore backup preSync:0/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Choose items for backup preSync:0/i })).toBeDisabled();
    });

    test('renders diagnostics separately from recovery tools', async () => {
        mockRecoveryMessages({
            groups: [],
            logs: [
                {
                    level: 'info',
                    message: 'Loaded sync data',
                    timestamp: '2026-03-31T10:15:00.000Z',
                    data: { collections: 2 },
                },
                {
                    level: 'error',
                    message: 'Refresh token is invalid',
                    timestamp: '2026-03-31T11:15:00.000Z',
                    data: { status: 401 },
                },
            ],
        });

        render(
            <SyncDebugRecoveryPanel
                isActive={true}
                isSyncEnabled={true}
                mode="diagnostics"
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
            />,
        );

        expect(await screen.findByRole('button', { name: /Force Download from Server/i })).toBeInTheDocument();
        expect(screen.getByText(/Loaded sync data/i)).toBeInTheDocument();
        expect(screen.getByText(/Refresh token is invalid/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Restore backup/i })).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText(/Search logs/i), {
            target: { value: 'refresh token' },
        });

        expect(await screen.findByText(/Refresh token is invalid/i)).toBeInTheDocument();
        expect(screen.queryByText(/Loaded sync data/i)).not.toBeInTheDocument();
    });

    test('hides sync-only diagnostics actions when sync is unavailable', async () => {
        mockRecoveryMessages({ groups: [], logs: [] });

        render(
            <SyncDebugRecoveryPanel
                isActive={true}
                isSyncEnabled={false}
                mode="diagnostics"
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
            />,
        );

        expect(await screen.findByText('Sync diagnostics are unavailable until you sign in to Google Drive.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Force Download from Server/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Reset Sync State/i })).not.toBeInTheDocument();
    });
});
