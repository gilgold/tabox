import React from 'react';
import { useRecoilValue } from 'recoil';
import { settingsDataState } from './atoms/settingsDataState';
import './CollectionListOptions.css';
import Switch from './Switch';


export function CollectionListOptions(props) {
    const settingsData = useRecoilValue(settingsDataState);

    const SortType = {
        COLOR: (a, b) => (b.color > a.color) ? 1 : ((a.color > b.color) ? -1 : 0),
        DATE: (a, b) => b.createdOn - a.createdOn
    }

    const handleSort = async (sortBy) => {
        if (!settingsData || settingsData.length === 0) return;
        let newSettingsData = [...settingsData];
        newSettingsData.sort(sortBy)
        await props.updateRemoteData(newSettingsData);
    }

    return <div>
        <div className="sort-icon" /> <span className="sortLabel">Sort by: </span>
        <button className="button" onClick={async () => handleSort(SortType.COLOR)}>Color</button>
        <button className="button" onClick={async () => handleSort(SortType.DATE)}>Newest</button>
        <div className="spacer" />
        <Switch 
            id="chkOpenNewWindow" 
            textOn={<span>Tabs will open in a <strong>new window</strong></span>} 
            textOff={<span>Tabs will be added to <strong>this window</strong></span>} />
    </div>;
}
