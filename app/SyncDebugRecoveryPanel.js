import React, { useEffect, useMemo, useState } from 'react';
import Modal from 'react-modal';
import {
    MdBugReport,
    MdChevronRight,
    MdClose,
    MdDoneAll,
    MdDownload,
    MdFolder,
    MdFolderOpen,
    MdOutlineRemoveDone,
    MdOutlineRestore,
    MdRefresh,
    MdSearch,
    MdSettingsBackupRestore,
    MdWarning,
} from 'react-icons/md';
import MultiSelectCheckbox from './MultiSelectCheckbox';
import { useOrphanRecoveryContext } from './OrphanRecoveryContext';
import { browser } from '../static/globals';
import { buildLegacyImportPayloadFromSelection, buildLegacyImportPreview } from './utils/legacyImportPreview';
import { loadAllCollections } from './utils/storageUtils';
import { showErrorToast, showSuccessToast } from './toastHelpers';
import './Modal.css';
import './SyncDebugRecoveryPanel.css';

const ROOT_SECTION_ID = 'root';
const MAX_VISIBLE_TAB_DETAILS = 4;

function formatBackupTimestamp(timestamp) {
    const parsedTimestamp = new Date(timestamp);
    return Number.isNaN(parsedTimestamp.getTime())
        ? 'Unknown time'
        : parsedTimestamp.toLocaleString();
}

function getBackupTitle(backup) {
    return backup?.label || formatBackupTimestamp(backup?.timestamp);
}

function isBackupRestorable(backup) {
    return Boolean(backup?.canSelectiveRestore && backup?.canOverwrite && backup?.previewType === 'full_export');
}

function matchesBackupPreview(collection, searchQuery) {
    if (!searchQuery) {
        return true;
    }

    const normalizedQuery = searchQuery.toLowerCase();
    if (collection?.name?.toLowerCase().includes(normalizedQuery)) {
        return true;
    }

    return (collection.previewTabs || []).some((tab) => (
        tab?.title?.toLowerCase().includes(normalizedQuery) ||
        tab?.url?.toLowerCase().includes(normalizedQuery)
    ));
}

function matchesLogEntry(log, searchQuery) {
    if (!searchQuery) {
        return true;
    }

    const haystack = [
        log?.timestamp,
        log?.level,
        log?.message,
        log?.data ? JSON.stringify(log.data) : '',
    ].join(' ').toLowerCase();

    return haystack.includes(searchQuery.toLowerCase());
}

function BackupRestorePickerModal({
    isOpen,
    onClose,
    backup,
    previewData,
    isLoading = false,
    isRestoring = false,
    selectedCollectionIds,
    onSelectionChange,
    onConfirm,
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedSectionIds, setCollapsedSectionIds] = useState(new Set());

    useEffect(() => {
        if (!isOpen) {
            setSearchQuery('');
            setCollapsedSectionIds(new Set());
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && previewData?.sections) {
            setCollapsedSectionIds(new Set());
        }
    }, [isOpen, previewData]);

    const selectedIdSet = useMemo(() => new Set(selectedCollectionIds), [selectedCollectionIds]);
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();

    const filteredPreviewSections = useMemo(() => {
        if (!previewData) {
            return [];
        }

        if (!normalizedSearchQuery) {
            return previewData.sections || [];
        }

        return (previewData.sections || []).reduce((sections, section) => {
            const matchingCollections = (section.collections || []).filter((collection) => matchesBackupPreview(collection, normalizedSearchQuery));
            const sectionMatches = section.title?.toLowerCase().includes(normalizedSearchQuery);

            if (!sectionMatches && matchingCollections.length === 0) {
                return sections;
            }

            sections.push({
                ...section,
                collections: sectionMatches && matchingCollections.length === 0
                    ? (section.collections || [])
                    : matchingCollections,
            });

            return sections;
        }, []);
    }, [previewData, normalizedSearchQuery]);

    const selectedCount = selectedCollectionIds.length;
    const visibleCollectionCount = filteredPreviewSections.reduce(
        (count, section) => count + (section.collections || []).length,
        0,
    );

    const toggleCollection = (previewId) => {
        onSelectionChange((previous) => (
            previous.includes(previewId)
                ? previous.filter((value) => value !== previewId)
                : [...previous, previewId]
        ));
    };

    const toggleSectionSelection = (section) => {
        const sectionPreviewIds = (section.collections || []).map((collection) => collection.previewId);
        const shouldSelectAll = sectionPreviewIds.some((previewId) => !selectedIdSet.has(previewId));

        onSelectionChange((previous) => {
            const next = new Set(previous);
            sectionPreviewIds.forEach((previewId) => {
                if (shouldSelectAll) {
                    next.add(previewId);
                } else {
                    next.delete(previewId);
                }
            });
            return Array.from(next);
        });
    };

    const toggleSectionVisibility = (sectionId) => {
        setCollapsedSectionIds((previous) => {
            const next = new Set(previous);
            if (next.has(sectionId)) {
                next.delete(sectionId);
            } else {
                next.add(sectionId);
            }
            return next;
        });
    };

    const renderPreviewTabs = (collection) => {
        const previewTabs = (collection.previewTabs || []).slice(0, MAX_VISIBLE_TAB_DETAILS);
        if (previewTabs.length === 0) {
            return null;
        }

        return (
            <div className="sync-recovery-picker-tabs" aria-label={`${collection.name} tab preview`}>
                {previewTabs.map((tab, index) => (
                    <span
                        key={`${collection.previewId}-${tab.url || tab.title || index}`}
                        className="sync-recovery-picker-tab"
                        title={tab.url || tab.title || ''}
                    >
                        {tab.title || tab.url || 'Untitled tab'}
                    </span>
                ))}
            </div>
        );
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Choose backup items"
            className="sync-recovery-picker-modal"
            overlayClassName="sync-recovery-picker-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={!isRestoring}
            shouldCloseOnEsc={!isRestoring}
        >
            <div className="sync-recovery-picker-shell">
                <div className="sync-recovery-picker-header">
                    <div>
                        <div className="sync-recovery-picker-title">
                            <MdSettingsBackupRestore />
                            <span>Choose items to restore</span>
                        </div>
                        <p>{backup ? getBackupTitle(backup) : 'Backup preview'}</p>
                    </div>
                    <button
                        type="button"
                        className="sync-recovery-icon-btn"
                        aria-label="Close restore picker"
                        onClick={onClose}
                        disabled={isRestoring}
                    >
                        <MdClose />
                    </button>
                </div>

                <div className="sync-recovery-picker-body">
                    {isLoading ? (
                        <div className="sync-recovery-empty-state">Loading backup preview...</div>
                    ) : !previewData ? (
                        <div className="sync-recovery-empty-state">This backup cannot be previewed for selective restore.</div>
                    ) : (
                        <>
                            <div className="sync-recovery-picker-summary">
                                <strong>{selectedCount} selected from {previewData.collections.length} collections</strong>
                                <span>{visibleCollectionCount} visible in the current view</span>
                            </div>

                            <div className="sync-recovery-picker-toolbar">
                                <label className="sync-recovery-search-field">
                                    <MdSearch size={16} />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        placeholder="Search collections or tabs"
                                    />
                                </label>
                                <button
                                    type="button"
                                    className="sync-recovery-toolbar-btn sync-recovery-picker-action-btn"
                                    onClick={() => onSelectionChange(previewData.collections.map((collection) => collection.previewId))}
                                >
                                    <MdDoneAll size={16} />
                                    <span>Select All</span>
                                </button>
                                <button
                                    type="button"
                                    className="sync-recovery-toolbar-btn sync-recovery-picker-action-btn secondary"
                                    onClick={() => onSelectionChange([])}
                                >
                                    <MdOutlineRemoveDone size={16} />
                                    <span>Select None</span>
                                </button>
                            </div>

                            <div className="sync-recovery-picker-list">
                                {filteredPreviewSections.length === 0 ? (
                                    <div className="sync-recovery-empty-state compact">No collections match this search.</div>
                                ) : (
                                    filteredPreviewSections.map((section) => {
                                        const sectionPreviewIds = (section.collections || []).map((collection) => collection.previewId);
                                        const selectedSectionCount = sectionPreviewIds.filter((previewId) => selectedIdSet.has(previewId)).length;
                                        const sectionChecked = sectionPreviewIds.length > 0 && selectedSectionCount === sectionPreviewIds.length;
                                        const SectionIcon = section.id === ROOT_SECTION_ID ? MdFolderOpen : MdFolder;
                                        const isCollapsed = !normalizedSearchQuery && collapsedSectionIds.has(section.id);

                                        return (
                                            <section
                                                key={section.id}
                                                className={[
                                                    'sync-recovery-picker-section',
                                                    isCollapsed ? 'is-collapsed' : 'is-expanded',
                                                    section.id === ROOT_SECTION_ID ? 'is-root-section' : 'is-folder-section',
                                                ].join(' ')}
                                            >
                                                <div className="sync-recovery-picker-section-header">
                                                    <MultiSelectCheckbox
                                                        checked={sectionChecked}
                                                        ariaLabel={`Restore ${section.title}`}
                                                        accentColor="var(--primary-color)"
                                                        onClick={() => toggleSectionSelection(section)}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="sync-recovery-picker-section-toggle"
                                                        aria-label={`Toggle ${section.title}`}
                                                        aria-expanded={!isCollapsed}
                                                        onClick={() => toggleSectionVisibility(section.id)}
                                                    >
                                                        {section.id === ROOT_SECTION_ID ? (
                                                            <span className="sync-recovery-root-badge">Root</span>
                                                        ) : (
                                                            <span
                                                                className="sync-recovery-color-swatch folder"
                                                                style={section.color ? { backgroundColor: section.color } : undefined}
                                                            />
                                                        )}
                                                        <SectionIcon size={18} />
                                                        <span className="sync-recovery-picker-section-title">{section.title}</span>
                                                        <span className="sync-recovery-picker-section-count">
                                                            {selectedSectionCount}/{sectionPreviewIds.length}
                                                        </span>
                                                        <MdChevronRight className={`sync-recovery-section-chevron${isCollapsed ? '' : ' is-open'}`} />
                                                    </button>
                                                </div>

                                                {!isCollapsed && (
                                                    <div className="sync-recovery-picker-collections">
                                                        {(section.collections || []).map((collection) => {
                                                            const isSelected = selectedIdSet.has(collection.previewId);

                                                            return (
                                                                <div
                                                                    key={collection.previewId}
                                                                    className={`sync-recovery-picker-item${isSelected ? ' is-selected' : ''}`}
                                                                >
                                                                    <div
                                                                        className="sync-recovery-picker-item-main"
                                                                        role="button"
                                                                        tabIndex={0}
                                                                        onClick={() => toggleCollection(collection.previewId)}
                                                                        onKeyDown={(event) => {
                                                                            if (event.key === 'Enter' || event.key === ' ') {
                                                                                event.preventDefault();
                                                                                toggleCollection(collection.previewId);
                                                                            }
                                                                        }}
                                                                    >
                                                                        <MultiSelectCheckbox
                                                                            checked={isSelected}
                                                                            ariaLabel={`Restore ${collection.name}`}
                                                                            accentColor="var(--primary-color)"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                toggleCollection(collection.previewId);
                                                                            }}
                                                                        />
                                                                        <span
                                                                            className="sync-recovery-color-swatch collection"
                                                                            style={collection.color ? { backgroundColor: collection.color } : undefined}
                                                                        />
                                                                        <div className="sync-recovery-picker-item-copy">
                                                                            <strong>{collection.name}</strong>
                                                                            <span>
                                                                                {collection.tabCount} {collection.tabCount === 1 ? 'tab' : 'tabs'} • {collection.groupCount} {collection.groupCount === 1 ? 'group' : 'groups'}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    {renderPreviewTabs(collection)}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </section>
                                        );
                                    })
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="sync-recovery-picker-footer">
                    <button
                        type="button"
                        className="sync-recovery-toolbar-btn secondary"
                        onClick={onClose}
                        disabled={isRestoring}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="sync-recovery-primary-action"
                        onClick={onConfirm}
                        disabled={!previewData || selectedCount === 0 || isRestoring}
                    >
                        <MdOutlineRestore size={16} />
                        <span>{isRestoring ? 'Restoring...' : `Restore ${selectedCount} selected`}</span>
                    </button>
                </div>
            </div>
        </Modal>
    );
}

function SyncDebugRecoveryPanel({
    isActive = false,
    isSyncEnabled = false,
    mode = 'recovery',
    applyDataFromServer,
    updateRemoteData,
    onDataUpdate,
    feedbackToasterId,
}) {
    const orphanRecovery = useOrphanRecoveryContext() || {};
    const [orphanPickerOpen, setOrphanPickerOpen] = useState(false);
    const [orphanSelectedIds, setOrphanSelectedIds] = useState([]);

    const [backupGroups, setBackupGroups] = useState([]);
    const [syncLogs, setSyncLogs] = useState([]);
    const [loadingBackups, setLoadingBackups] = useState(false);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [actionInFlight, setActionInFlight] = useState(false);
    const [logSearchQuery, setLogSearchQuery] = useState('');
    const [pickerBackup, setPickerBackup] = useState(null);
    const [pickerPreviewData, setPickerPreviewData] = useState(null);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);

    useEffect(() => {
        if (!isActive || mode !== 'recovery') {
            return undefined;
        }

        let cancelled = false;

        const loadBackups = async () => {
            setLoadingBackups(true);

            try {
                const backupOptions = await browser.runtime.sendMessage({ type: 'getBackupOptions' });
                if (!cancelled) {
                    setBackupGroups(backupOptions?.groups || []);
                }
            } catch (error) {
                console.error('Failed to load recovery backups:', error);
                if (!cancelled) {
                    setBackupGroups([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingBackups(false);
                }
            }
        };

        loadBackups();

        return () => {
            cancelled = true;
        };
    }, [isActive, mode]);

    useEffect(() => {
        if (!isActive || mode !== 'diagnostics') {
            return undefined;
        }

        let cancelled = false;

        const loadLogs = async () => {
            setLoadingLogs(true);

            try {
                const logs = await browser.runtime.sendMessage({ type: 'getSyncLogs' });
                if (!cancelled) {
                    setSyncLogs(logs || []);
                }
            } catch (error) {
                console.error('Failed to load sync diagnostics:', error);
                if (!cancelled) {
                    setSyncLogs([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingLogs(false);
                }
            }
        };

        loadLogs();

        return () => {
            cancelled = true;
        };
    }, [isActive, mode]);

    const backups = useMemo(
        () => backupGroups.flatMap((group) => group.items || []),
        [backupGroups],
    );

    const filteredLogs = useMemo(
        () => syncLogs.filter((log) => matchesLogEntry(log, logSearchQuery.trim())),
        [syncLogs, logSearchQuery],
    );

    const orphanPreviewData = useMemo(() => {
        const collections = (orphanRecovery.orphans || []).map((o) => ({
            previewId: o.uid,
            name: o.name,
            tabCount: o.tabCount,
            groupCount: 0,
            color: o.color,
            previewTabs: [],
        }));
        return { collections, sections: [{ id: 'root', title: 'Recoverable', collections }] };
    }, [orphanRecovery.orphans]);

    const refreshVisibleData = async () => {
        if (typeof onDataUpdate === 'function') {
            await onDataUpdate();
            return;
        }

        if (typeof updateRemoteData === 'function' && browser?.storage?.local) {
            const refreshedCollections = await loadAllCollections();
            await updateRemoteData(refreshedCollections);
        }
    };

    const loadFullBackupPreview = async (backup) => {
        const preview = await browser.runtime.sendMessage({
            type: 'getBackupPreview',
            backupId: backup.id,
        });

        if (preview?.kind !== 'full_export' || !preview?.payload) {
            throw new Error('This backup does not include restorable collection data');
        }

        return buildLegacyImportPreview(preview.payload);
    };

    const sendRestoreRequest = async ({ backup, previewData, selectedIds, successMessage }) => {
        const payload = buildLegacyImportPayloadFromSelection({
            parsedImportData: previewData.parsedImportData,
            selectedCollectionIds: selectedIds,
            allPreviewCollections: previewData.collections,
        });

        const result = await browser.runtime.sendMessage({
            type: 'restoreBackupSelection',
            backupId: backup.id,
            mode: 'overwrite',
            payload,
        });

        if (!result?.success) {
            throw new Error(result?.error || 'Restore failed');
        }

        await refreshVisibleData();
        showSuccessToast(successMessage, 3000, { toasterId: feedbackToasterId });
    };

    const handleRestoreBackup = async (backup) => {
        if (!isBackupRestorable(backup) || actionInFlight) {
            return;
        }

        const confirmed = confirm('Restore this backup and overwrite matching saved items? Current unrelated items will stay untouched.');
        if (!confirmed) {
            return;
        }

        setActionInFlight(true);
        try {
            const previewData = await loadFullBackupPreview(backup);
            await sendRestoreRequest({
                backup,
                previewData,
                selectedIds: previewData.collections.map((collection) => collection.previewId),
                successMessage: 'Backup restored by overwriting matching saved items',
            });
        } catch (error) {
            console.error('Backup restore failed:', error);
            showErrorToast(error.message || 'Restore failed', { toasterId: feedbackToasterId });
        } finally {
            setActionInFlight(false);
        }
    };

    const openPicker = async (backup) => {
        if (!isBackupRestorable(backup) || actionInFlight) {
            return;
        }

        setPickerBackup(backup);
        setPickerPreviewData(null);
        setSelectedCollectionIds([]);
        setPickerLoading(true);

        try {
            const previewData = await loadFullBackupPreview(backup);
            setPickerPreviewData(previewData);
            setSelectedCollectionIds(previewData.collections.map((collection) => collection.previewId));
        } catch (error) {
            console.error('Failed to load backup picker preview:', error);
            showErrorToast(error.message || 'Failed to load backup preview', { toasterId: feedbackToasterId });
            setPickerBackup(null);
        } finally {
            setPickerLoading(false);
        }
    };

    const closePicker = () => {
        if (actionInFlight) {
            return;
        }

        setPickerBackup(null);
        setPickerPreviewData(null);
        setSelectedCollectionIds([]);
        setPickerLoading(false);
    };

    const handleRestoreSelected = async () => {
        if (!pickerBackup || !pickerPreviewData || selectedCollectionIds.length === 0 || actionInFlight) {
            return;
        }

        const confirmed = confirm('Overwrite the selected backup items with this backup? Current unrelated items will stay untouched.');
        if (!confirmed) {
            return;
        }

        setActionInFlight(true);
        try {
            await sendRestoreRequest({
                backup: pickerBackup,
                previewData: pickerPreviewData,
                selectedIds: selectedCollectionIds,
                successMessage: 'Selected backup items were restored',
            });
            setPickerBackup(null);
            setPickerPreviewData(null);
            setSelectedCollectionIds([]);
        } catch (error) {
            console.error('Selected restore failed:', error);
            showErrorToast(error.message || 'Restore failed', { toasterId: feedbackToasterId });
        } finally {
            setActionInFlight(false);
        }
    };

    const handleForceDownload = async () => {
        setActionInFlight(true);
        try {
            await applyDataFromServer?.(true);
            showSuccessToast('Sync download requested', 3000, { toasterId: feedbackToasterId });
        } catch (error) {
            console.error('Force download failed:', error);
            showErrorToast(error.message || 'Failed to download from server', { toasterId: feedbackToasterId });
        } finally {
            setActionInFlight(false);
        }
    };

    const handleSyncReset = async () => {
        const confirmed = confirm('This will reset sync state and force a complete re-sync. Continue?');
        if (!confirmed) {
            return;
        }

        setActionInFlight(true);
        try {
            const result = await browser.runtime.sendMessage({ type: 'forceSyncReset' });
            if (!result) {
                throw new Error('Sync reset failed');
            }
            showSuccessToast('Sync reset completed', 3000, { toasterId: feedbackToasterId });
        } catch (error) {
            console.error('Sync reset failed:', error);
            showErrorToast(error.message || 'Sync reset failed', { toasterId: feedbackToasterId });
        } finally {
            setActionInFlight(false);
        }
    };

    const downloadLogs = () => {
        const logsText = JSON.stringify(syncLogs, null, 2);
        const blob = new Blob([logsText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tabox-sync-logs-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const renderRecoveryView = () => (
        <>
            {orphanRecovery.showEntry && (
                <section className="sync-recovery-orphan-card">
                    <div className="sync-recovery-orphan-copy">
                        <strong>Hidden collections found</strong>
                        <span>{orphanRecovery.orphanCount} recoverable — collections an earlier update hid. They&apos;re safe on your device.</span>
                    </div>
                    <button
                        type="button"
                        className="sync-recovery-primary-action"
                        disabled={orphanRecovery.busy}
                        onClick={() => { setOrphanSelectedIds((orphanRecovery.orphans || []).map((o) => o.uid)); setOrphanPickerOpen(true); }}
                    >
                        <MdOutlineRestore size={16} />
                        <span>Review &amp; Restore</span>
                    </button>
                </section>
            )}
            <div className="sync-recovery-header">
                <div className="sync-recovery-header-copy">
                    <div className="sync-recovery-eyebrow">
                        <MdSettingsBackupRestore size={15} />
                        <span>Recovery</span>
                    </div>
                    <h4>Recover from backups</h4>
                    <p>Restore a complete backup from the row, or choose specific collections when you need a narrower recovery.</p>
                </div>
            </div>

            <section className="sync-recovery-backups-panel">
                <div className="sync-recovery-panel-header">
                    <div>
                        <h5>Backups</h5>
                        <p className="sync-recovery-panel-subtitle">Whole-backup restore overwrites matching saved items and keeps unrelated current items untouched.</p>
                    </div>
                    <span>{backups.length} total</span>
                </div>

                {loadingBackups ? (
                    <p className="sync-recovery-empty">Loading backup inventory...</p>
                ) : backupGroups.length === 0 ? (
                    <p className="sync-recovery-empty">No recoverable backups are available on this device yet.</p>
                ) : (
                    <div className="sync-recovery-backup-groups">
                        {backupGroups.map((group) => (
                            <div key={group.key} className="sync-recovery-backup-group">
                                <div className="sync-recovery-backup-group-title">{group.title}</div>
                                {(group.items || []).map((backup) => {
                                    const restorable = isBackupRestorable(backup);

                                    return (
                                        <div
                                            key={backup.id}
                                            className={`sync-recovery-backup-row${restorable ? '' : ' is-limited'}`}
                                        >
                                            <div className="sync-recovery-backup-main">
                                                <div className="sync-recovery-backup-title-row">
                                                    <strong>{getBackupTitle(backup)}</strong>
                                                    <span className={`sync-recovery-backup-badge ${backup.previewType}`}>
                                                        {restorable ? 'Ready to restore' : 'Limited metadata only'}
                                                    </span>
                                                </div>
                                                <div className="sync-recovery-backup-subline">
                                                    <span className="sync-recovery-backup-count-badge">
                                                        {backup.collectionCount} {backup.collectionCount === 1 ? 'collection' : 'collections'}
                                                    </span>
                                                    <span className="sync-recovery-backup-count-badge">
                                                        {backup.folderCount} {backup.folderCount === 1 ? 'folder' : 'folders'}
                                                    </span>
                                                    <span>{formatBackupTimestamp(backup.timestamp)}</span>
                                                </div>
                                            </div>
                                            <div className="sync-recovery-backup-actions">
                                                <button
                                                    type="button"
                                                    className="sync-recovery-primary-action"
                                                    aria-label={`Restore backup ${backup.id}`}
                                                    disabled={!restorable || actionInFlight}
                                                    onClick={() => handleRestoreBackup(backup)}
                                                >
                                                    <MdOutlineRestore size={16} />
                                                    <span>Restore</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="sync-recovery-secondary-action"
                                                    aria-label={`Choose items for backup ${backup.id}`}
                                                    disabled={!restorable || actionInFlight}
                                                    onClick={() => openPicker(backup)}
                                                >
                                                    Choose items
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <BackupRestorePickerModal
                isOpen={Boolean(pickerBackup)}
                onClose={closePicker}
                backup={pickerBackup}
                previewData={pickerPreviewData}
                isLoading={pickerLoading}
                isRestoring={actionInFlight}
                selectedCollectionIds={selectedCollectionIds}
                onSelectionChange={setSelectedCollectionIds}
                onConfirm={handleRestoreSelected}
            />
            <BackupRestorePickerModal
                isOpen={orphanPickerOpen}
                onClose={() => setOrphanPickerOpen(false)}
                backup={{ label: 'Hidden collections' }}
                previewData={orphanPreviewData}
                isLoading={false}
                isRestoring={orphanRecovery.busy}
                selectedCollectionIds={orphanSelectedIds}
                onSelectionChange={setOrphanSelectedIds}
                onConfirm={async () => {
                    const res = await orphanRecovery.recover(orphanSelectedIds);
                    if (res?.success) setOrphanPickerOpen(false);
                }}
            />
        </>
    );

    const renderDiagnosticsView = () => (
        <>
            <div className="sync-recovery-header">
                <div className="sync-recovery-header-copy">
                    <div className="sync-recovery-eyebrow">
                        <MdBugReport size={15} />
                        <span>Diagnostics</span>
                    </div>
                    <h4>Inspect sync health and logs</h4>
                    <p>Review recent sync activity, export logs, and run server recovery actions when Google Drive sync is enabled.</p>
                </div>

                {isSyncEnabled ? (
                    <div className="sync-recovery-sync-tools">
                        <button type="button" className="sync-recovery-utility-btn" onClick={handleForceDownload} disabled={actionInFlight}>
                            <MdRefresh size={16} />
                            <span>Force Download from Server</span>
                        </button>
                        <button type="button" className="sync-recovery-utility-btn danger" onClick={handleSyncReset} disabled={actionInFlight}>
                            <MdWarning size={16} />
                            <span>Reset Sync State</span>
                        </button>
                    </div>
                ) : (
                    <div className="sync-recovery-banner">
                        <MdWarning size={16} />
                        <span>Sync diagnostics are unavailable until you sign in to Google Drive.</span>
                    </div>
                )}
            </div>

            <section className="sync-recovery-logs-panel">
                <div className="sync-recovery-panel-header">
                    <div>
                        <h5>Sync Logs</h5>
                        <p className="sync-recovery-panel-subtitle">Search, inspect, and export the recent sync timeline in a log viewer format.</p>
                    </div>
                    <div className="sync-recovery-log-tools">
                        <label className="sync-recovery-search-field compact">
                            <MdSearch size={16} />
                            <input
                                type="text"
                                value={logSearchQuery}
                                onChange={(event) => setLogSearchQuery(event.target.value)}
                                placeholder="Search logs"
                            />
                        </label>
                        <button
                            type="button"
                            className="sync-recovery-toolbar-btn"
                            onClick={downloadLogs}
                            disabled={syncLogs.length === 0}
                        >
                            <MdDownload size={14} />
                            <span>Export</span>
                        </button>
                    </div>
                </div>

                <div className="sync-recovery-logviewer" role="log" aria-label="Sync logs">
                    {loadingLogs ? (
                        <div className="sync-recovery-log-empty">Loading sync logs...</div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="sync-recovery-log-empty">No log entries match the current search.</div>
                    ) : (
                        filteredLogs.map((log, index) => (
                            <div key={`${log.timestamp}-${index}`} className={`sync-recovery-log-line ${log.level || 'info'}`}>
                                <span className="sync-recovery-log-time">{log.timestamp?.slice(11, 19) || '--:--:--'}</span>
                                <span className={`sync-recovery-log-level ${log.level || 'info'}`}>{(log.level || 'info').toUpperCase()}</span>
                                <span className="sync-recovery-log-message">{log.message}</span>
                                {log.data && Object.keys(log.data).length > 0 && (
                                    <pre className="sync-recovery-log-json">{JSON.stringify(log.data, null, 2)}</pre>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </section>
        </>
    );

    return (
        <div className={`sync-recovery-panel sync-recovery-panel-${mode}`}>
            {mode === 'diagnostics' ? renderDiagnosticsView() : renderRecoveryView()}
        </div>
    );
}

export default SyncDebugRecoveryPanel;
