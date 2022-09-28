import React, { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { settingsDataState } from './atoms/globalAppSettingsState';
import './CollectionListOptions.css';
import Switch from './Switch';
import Select from 'react-select';
import { sortOptions, SortType } from './model/SortOptions';
import { browser } from '../static/globals';


export function CollectionListOptions(props) {
    const settingsData = useRecoilValue(settingsDataState);
    const [sortValue, setSortValue] = useState(sortOptions.find(o => o.value === props.selected));

    const handleSort = async (sortBy) => {
        if (!settingsData || settingsData.length === 0) return;
        let newSettingsData = [...settingsData];
        newSettingsData.sort(SortType[sortBy])
        await props.updateRemoteData(newSettingsData);
    }

    const formatOptionLabel = ({ label, icon }) => (
        <div className='sort-select-custom-option'>
            <div style={{ minWidth: '18px' }}>{icon}</div>
            <div>{label}</div>
        </div>
    );

    const handleChange = async (option) => {
        setSortValue(option);
        await browser.storage.local.set({ currentSortValue: option.value })
        handleSort(option.value);
    };

    const styles = {
        control: (base) => ({
          ...base,
          minHeight: 18,
        }),
        input: (base) => ({
            ...base,
            minHeight: 16,
            padding: 0
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

    return <div className="options-wrapper">
        <div className="sort-icon" /> <span className="sortLabel">Sort by: </span>
        <Select
            value={sortValue}
            formatOptionLabel={formatOptionLabel}
            onChange={async (e) => await handleChange(e)}
            options={sortOptions}
            className="sort-select-container"
            classNamePrefix={'sort-select'}
            styles={styles}
        />
        <div className="verticle-divider" />
        <Switch 
            id="chkOpenNewWindow" 
            textOn={<span>Tabs will open in a <strong>new window</strong></span>} 
            textOff={<span>Tabs will be added to <strong>this window</strong></span>} />
    </div>;
}
