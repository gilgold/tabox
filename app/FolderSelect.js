import React from 'react';
import Select from 'react-select';
import { MdFolder } from 'react-icons/md';
import { getColorValue } from './utils/colorMigration';
import './FolderSelect.css';

function FolderSelect({ folders, value, onChange, inputId, disabled }) {
    const options = [
        { value: '', label: 'Root level (no folder)' },
        ...folders.map(folder => ({ value: folder.uid, label: folder.name, color: folder.color })),
    ];

    return (
        <Select
            inputId={inputId}
            className="folder-select"
            classNamePrefix="folder-select"
            unstyled
            options={options}
            value={options.find(option => option.value === value) || options[0]}
            onChange={option => onChange(option.value)}
            isDisabled={disabled}
            isSearchable
            menuPortalTarget={document.body}
            menuPosition="fixed"
            maxMenuHeight={240}
            noOptionsMessage={() => 'No folders found.'}
            formatOptionLabel={option => (
                <span className="folder-select-label">
                    <MdFolder aria-hidden="true" style={{ color: !option.value ? 'var(--quick-save-root-color, #868b93)' : option.color && option.color !== 'default' ? getColorValue(option.color) : 'var(--primary-color)' }} />
                    <span>{option.label}</span>
                </span>
            )}
        />
    );
}

export default FolderSelect;
