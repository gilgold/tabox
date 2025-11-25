import React, { useEffect, useState, useRef, Activity } from 'react';
import './Modal.css';
import { MdBugReport } from 'react-icons/md';
import { browser } from '../static/globals';

export const SyncDebugModal = ({ isOpen, onClose, applyDataFromServer, updateRemoteData, onRecoverySuccess }) => {
    const [syncLogs, setSyncLogs] = useState([]);
    const [backupOptions, setBackupOptions] = useState(null);
    const [loading, setLoading] = useState(false);
    const isMountedRef = useRef(true);

    useEffect(() => {
        if (isOpen) {
            loadSyncLogs();
            loadBackupOptions();
        }
        
        // Cleanup function to prevent state updates on unmounted component
        return () => {
            isMountedRef.current = false;
        };
    }, [isOpen]);

    const loadSyncLogs = async () => {
        const logs = await browser.runtime.sendMessage({ type: 'getSyncLogs' });
        if (isMountedRef.current) {
            setSyncLogs(logs || []);
        }
    };

    const loadBackupOptions = async () => {
        const options = await browser.runtime.sendMessage({ type: 'getBackupOptions' });
        if (isMountedRef.current) {
            setBackupOptions(options);
        }
    };

    const handleRecoverFromBackup = async (backupType, backupIndex) => {
        if (!isMountedRef.current) return;
        
        setLoading(true);
        try {
            // 🚀 NEW: Store current collections from NEW STORAGE before recovery for undo functionality
            const { loadAllCollections } = await import('./utils/storageUtils');
            const previousCollections = await loadAllCollections();
            
            const result = await browser.runtime.sendMessage({ 
                type: 'recoverFromBackup', 
                backupType, 
                backupIndex 
            });
            
            if (!isMountedRef.current) return;
            
            if (result) {
                // 🚀 NEW: Reload the UI with recovered data from NEW STORAGE
                const recoveredCollections = await loadAllCollections();
                updateRemoteData(recoveredCollections);
                
                // Show success snackbar with undo option via callback
                if (onRecoverySuccess) {
                    onRecoverySuccess(previousCollections);
                }
                
                onClose();
            } else {
                alert('Failed to recover from backup');
            }
        } catch (error) {
            console.error('Recovery error:', error);
            if (isMountedRef.current) {
                alert('Error during recovery');
            }
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    };

    const handleSyncReset = async () => {
        if (!isMountedRef.current) return;
        
        if (confirm('This will reset sync state and force a complete re-sync. Continue?')) {
            if (!isMountedRef.current) return;
            
            setLoading(true);
            try {
                await browser.runtime.sendMessage({ type: 'forceSyncReset' });
                
                if (!isMountedRef.current) return;
                
                alert('Sync reset completed. Please check sync status.');
                onClose();
            } catch (error) {
                console.error('Sync reset error:', error);
                if (isMountedRef.current) {
                    alert('Error during sync reset');
                }
            } finally {
                if (isMountedRef.current) {
                    setLoading(false);
                }
            }
        }
    };

    const downloadLogs = () => {
        const logsText = JSON.stringify(syncLogs, null, 2);
        const blob = new Blob([logsText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tabox-sync-logs-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Activity mode={isOpen ? 'visible' : 'hidden'}>
            <div className='modal-card sync-debug-modal'>
                <div className='modal-card-wrapper'>
                <div className='modal-card-image'>
                    <MdBugReport size="50px" style={{ color: 'var(--primary-color)' }} />
                </div>
                <div className='modal-card-content'>
                    <div className='modal-card-header'>
                        Sync Debug & Recovery
                    </div>
                    <div className='modal-card-body sync-debug-modal-body'>
                        {backupOptions && (
                            <div className='modal-card-body-section sync-debug-section'>
                                <strong className='sync-debug-section-title'>Available Backups</strong>
                                
                                {backupOptions.preSyncBackups.length > 0 && (
                                    <div className='sync-debug-backup-group'>
                                        <div className='sync-debug-backup-group-title'>Pre-Sync Backups:</div>
                                        {backupOptions.preSyncBackups.slice(0, 3).map((backup, index) => (
                                            <div key={index} className='sync-debug-backup-item'>
                                                <span>
                                                    {backup.label} - {new Date(backup.timestamp).toLocaleString()} 
                                                    ({backup.tabsArray?.length || 0} collections)
                                                </span>
                                                <button 
                                                    onClick={() => handleRecoverFromBackup('preSync', index)}
                                                    disabled={loading}
                                                    className="modal-button sync-debug-backup-btn"
                                                >
                                                    Restore
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {backupOptions.autoBackups.length > 0 && (
                                    <div className='sync-debug-backup-group'>
                                        <div className='sync-debug-backup-group-title'>Auto Backups:</div>
                                        {backupOptions.autoBackups.slice(0, 3).map((backup, index) => (
                                            <div key={index} className='sync-debug-backup-item'>
                                                <span>
                                                    {new Date(backup.timestamp).toLocaleString()} 
                                                    ({backup.tabsArray?.length || 0} collections)
                                                </span>
                                                <button 
                                                    onClick={() => handleRecoverFromBackup('auto', index)}
                                                    disabled={loading}
                                                    className="modal-button sync-debug-backup-btn"
                                                >
                                                    Restore
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className='modal-card-body-section sync-debug-section'>
                            <div className='sync-debug-header-row'>
                                <strong>Recent Sync Logs ({syncLogs.length})</strong>
                                <button 
                                    onClick={downloadLogs} 
                                    disabled={loading}
                                    className='sync-debug-download-btn'
                                >
                                    📄 Download Logs
                                </button>
                            </div>
                            <div className='sync-debug-logs-container'>
                                {syncLogs.slice(0, 20).map((log, index) => (
                                    <div key={index} className='sync-debug-log-entry'>
                                        <div className={`sync-debug-log-level ${log.level}`}>
                                            <strong>[{log.timestamp.slice(11, 19)}]</strong> {log.message}
                                        </div>
                                        {log.data && Object.keys(log.data).length > 0 && (
                                            <div className='sync-debug-log-data'>
                                                {JSON.stringify(log.data, null, 2)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className='modal-card-body-section sync-debug-section'>
                            <strong className='sync-debug-section-title'>Recovery Actions</strong>
                            <div className='sync-debug-actions'>
                                <button 
                                    onClick={() => applyDataFromServer(true)}
                                    disabled={loading}
                                    className="modal-button sync-debug-action-btn"
                                >
                                    🔄 Force Download from Server
                                </button>
                                <button 
                                    onClick={handleSyncReset}
                                    disabled={loading}
                                    className="modal-button sync-debug-action-btn"
                                >
                                    ⚠️ Reset Sync State
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="button-row">
                <button className="modal-button" onClick={onClose}>Close</button>
            </div>
        </div>
        </Activity>
    );
}; 