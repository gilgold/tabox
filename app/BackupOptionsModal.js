import React, { useEffect, useState } from 'react';
import './BackupOptionsModal.css';
import './CollectionListOptions.css';
import { FcDataBackup } from 'react-icons/fc';
import Select from 'react-select';
import { MdSettingsBackupRestore, MdOutlineInstallDesktop, MdCloudDownload } from 'react-icons/md';

export const BackupOptionsModal = (props) => {

    const [backup, setBackup] = useState();

    const styles = {
        control: (base) => ({
            ...base,
            minHeight: 18,
            flex: '0 0 100%',
        }),
        input: (base, state) => ({
            ...base,
            minHeight: 16,
            padding: 0,
            "&:hover": {
                backgroundColor: state.isDisabled ? 'transparent !imkportant' : base.backgroundColor
            }
        }),
        dropdownIndicator: (base) => ({
            ...base,
            paddingTop: 0,
            paddingBottom: 0,
            color: 'var(--settings-row-text-color)'
        }),
        clearIndicator: (base) => ({
            ...base,
            paddingTop: 0,
            paddingBottom: 0,
        }),
    };

    const formatOptionLabel = ({ label, icon }) => {
        if (label === 'divider') {
            return <div className='hr' style={{ borderColor: 'var(--text-color)' }} />
        }
        return <div className='sort-select-custom-option'>
            <div style={{ minWidth: '18px', paddingTop: '2px' }}>{icon}</div>
            <div>{label}</div>
        </div>
    };

    const handleChange = async (option) => {
        setBackup(option.value);
    };

    const handleConfirmation = async () => {
        if (backup === 'remote') {
            await props.applyDataFromServer(true);
        } else {
            await props.updateRemoteData(backup.tabsArray);
        }
        props.onConfirm();
    }

    const getBackupLabel = (backup) => {
        if (!backup || !backup.tabsArray) return;
        return `${(new Date(backup.timestamp)).toLocaleString()} | ${backup.tabsArray.length} Collection${backup.tabsArray.length > 1 ? 's' : ''}`;
    }

    const [options, setOptions] = useState([]);

    useEffect(() => {
        let backupOptions = [];
        const autoBackups = props.autoBackups || [];
        for (const backup of autoBackups) {
            if (!backup.tabsArray) continue;
            backupOptions.push({
                value: backup,
                label: getBackupLabel(backup),
                icon: <MdSettingsBackupRestore />
            })
        }
        if (backupOptions.length === 0) {
            backupOptions.push({
                value: 'no-options',
                label: 'No automatic backups available, try again later',
                isDisabled: true
            });
        }
        backupOptions.push({
            value: 'divider',
            label: 'divider',
            isDisabled: true
        });
        if (props.onUpdateBackup) {
            backupOptions.push({
                value: props.onUpdateBackup,
                label: `Restore from version update (v${props.onUpdateBackup.version})`,
                icon: <MdOutlineInstallDesktop />
            });
        }
        if (props.isLoggedIn) {
            backupOptions.push({
                value: 'remote',
                label: 'Restore from Google Drive',
                icon: <MdCloudDownload />
            });
        }
        setOptions(backupOptions);
    }, []);

    return (
        <div className='modal-card'>
            <div className='modal-card-wrapper'>
                <div className='modal-card-image'>
                    <FcDataBackup size="50px" />
                </div>
                <div className='modal-card-content'>
                    <div className='modal-card-header'>
                        Restore from backup?
                    </div>
                    <div className='modal-card-body'>
                        <div className='modal-card-body-section'>
                            Select a backup optoin from the drop down list.<br />
                            This will overwrite your synced data and cannot be undone!
                        </div>
                        <div className='modal-card-body-section'>
                            <Select
                                options={options}
                                onChange={async (e) => await handleChange(e)}
                                formatOptionLabel={formatOptionLabel}
                                styles={styles}
                                placeholder="Select a backup to restore"
                                className="backup-select-container"
                                classNamePrefix={'sort-select'}
                                minWidth="300px"
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div className="button-row">
                <button className="modal-button" onClick={props.onClose}>{props.cancelLabel}</button>
                <button className="modal-button primary" onClick={handleConfirmation}>{props.confirmLabel}</button>
            </div>
        </div>
    );
}