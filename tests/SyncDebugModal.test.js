/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SyncDebugModal } from '../app/SyncDebugModal';
import { browser } from '../static/globals';
import { loadAllCollections } from '../app/utils/storageUtils';

jest.mock('../static/globals', () => ({
    browser: {
        runtime: {
            sendMessage: jest.fn(),
        },
    },
}));

jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
}));

describe('SyncDebugModal', () => {
    const syncLogs = [
        {
            level: 'info',
            message: 'Loaded sync data',
            timestamp: '2026-03-31T10:15:00.000Z',
            data: { collections: 2 },
        },
    ];

    const backupOptions = {
        preSyncBackups: [
            {
                label: 'Before upload',
                timestamp: '2026-03-30T10:00:00.000Z',
                tabsArray: [{ uid: 'collection-1' }],
            },
        ],
        autoBackups: [
            {
                timestamp: '2026-03-29T09:00:00.000Z',
                tabsArray: [{ uid: 'collection-2' }, { uid: 'collection-3' }],
            },
        ],
    };

    beforeEach(() => {
        browser.runtime.sendMessage.mockImplementation(async (message) => {
            switch (message.type) {
                case 'getSyncLogs':
                    return syncLogs;
                case 'getBackupOptions':
                    return backupOptions;
                case 'recoverFromBackup':
                    return true;
                case 'forceSyncReset':
                    return true;
                default:
                    return undefined;
            }
        });

        loadAllCollections.mockReset();
        global.alert = jest.fn();
        global.confirm = jest.fn(() => true);
    });

    test('loads sync logs and restores from backup with undo state', async () => {
        const previousCollections = [{ uid: 'previous-1' }];
        const recoveredCollections = [{ uid: 'recovered-1' }];
        const updateRemoteData = jest.fn();
        const onRecoverySuccess = jest.fn();
        const onClose = jest.fn();

        loadAllCollections
            .mockResolvedValueOnce(previousCollections)
            .mockResolvedValueOnce(recoveredCollections);

        render(
            <SyncDebugModal
                isOpen={true}
                onClose={onClose}
                applyDataFromServer={jest.fn()}
                updateRemoteData={updateRemoteData}
                onRecoverySuccess={onRecoverySuccess}
            />,
        );

        expect(await screen.findByText(/Recent Sync Logs \(1\)/)).toBeInTheDocument();
        expect(screen.getByText(/Before upload/i)).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'recoverFromBackup',
                backupType: 'preSync',
                backupIndex: 0,
            });
        });

        expect(updateRemoteData).toHaveBeenCalledWith(recoveredCollections);
        expect(onRecoverySuccess).toHaveBeenCalledWith(previousCollections);
        expect(onClose).toHaveBeenCalled();
    });

    test('supports force download and reset sync actions', async () => {
        const applyDataFromServer = jest.fn();
        const onClose = jest.fn();

        render(
            <SyncDebugModal
                isOpen={true}
                onClose={onClose}
                applyDataFromServer={applyDataFromServer}
                updateRemoteData={jest.fn()}
                onRecoverySuccess={jest.fn()}
            />,
        );

        await screen.findByText(/Recent Sync Logs \(1\)/);

        fireEvent.click(screen.getByRole('button', { name: /Force Download from Server/i }));
        expect(applyDataFromServer).toHaveBeenCalledWith(true);

        fireEvent.click(screen.getByRole('button', { name: /Reset Sync State/i }));

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'forceSyncReset' });
        });

        expect(global.confirm).toHaveBeenCalled();
        expect(global.alert).toHaveBeenCalledWith('Sync reset completed. Please check sync status.');
        expect(onClose).toHaveBeenCalled();
    });
});
