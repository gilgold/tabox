import React, { useState, useEffect } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import './CollectionList.css';
import { settingsDataState } from './atoms/settingsDataState';
import { rowToHighlightState } from './atoms/animationsState';
import { useAnimateKeyframes } from 'react-simple-animate';
import { 
    isHighlightedState, themeState, 
} from './atoms/globalAppSettingsState';
import { getCurrentTabsAndGroups } from './utils';
import { ReactSortable } from 'react-sortablejs';
import { browser } from '../static/index';
import Popover from 'react-popover';
import Switch from './Switch';
import ReactTooltip from 'react-tooltip';


function ColorPicker(props) {

    const [color, setColor] = useState(props?.currentColor ?? 'var(--bg-color)');
    const [showPicker, setShowPicker] = useState(false);
    const [selectedColorCircle, setSelectedColorCircle] = useState(0);
    const settingsData = useRecoilValue(settingsDataState);

    const colorList = [
        'var(--bg-color)',
        '#B60205',
        '#D93F0B',
        '#FBCA04',
        '#0E8A16',
        '#1D76DB',
        '#0052CC',
        '#6330e4',
        '#f78786',
        '#f1bc97',
        '#f3e3a2',
        '#95e6b2',
        '#acf4f9',
        '#99bdff',
        '#C5DEF5',
        '#6294dc',
        '#b499f7'
    ]

    useEffect(() => {
        setColor(props?.currentColor ?? 'var(--bg-color)')
        if (props.currentColor) {
            const colorIndex = colorList.findIndex(element => element === props.currentColor);
            setSelectedColorCircle(colorIndex);
        }
    },[settingsData]);

    const handleChange = async (color, index) => {
        setColor(color);
        setSelectedColorCircle(index);
        let newSettingsData = [...settingsData];
        let newCollectionItem = {...newSettingsData[props.collectionIndex]};
        newCollectionItem.color = color;
        newSettingsData[props.collectionIndex] = newCollectionItem;
        await props.updateRemoteData(newSettingsData);
    };

    const handleClick = () => {
        setShowPicker(!showPicker);
    };

    const handleClose = (e) => {
        if (e && ['colorOption'].includes(e.target.className)) return;
        setShowPicker(false);
    };

    return <Popover
        isOpen={showPicker}
        onOuterAction={handleClose}
        preferPlace={'right'}
        tipSize={0.01}
        body={
            <div className="popover">
            { colorList.map((_color, index) => index === 8 ? 
                <div className="break" key={'breaker'} /> : 
                <div 
                    key={`color-${index}`} 
                    onClick={async () => await handleChange(_color, index)} 
                    className={`colorOption`} 
                    style={{backgroundColor: _color}}>
                        <div className={`selectedInnerCircle ${ index === selectedColorCircle ? 'selected' : ''}`}/>
                </div>
            )}
            </div>
        }
        children={
            <div onClick={handleClick} data-tip-disable={showPicker} data-tip="Choose a color for this collection">
                <div className="colorPicker" style={{ borderColor: color === 'var(--bg-color)' ? 'var(--settings-row-text-color)' : color }} onClick={handleClick}>
                    <div className="currentColor" style={ {backgroundColor: color} } />
                </div>
            </div>
        }
    />
}

function CollectionListItem(props) {
    const settingsData = useRecoilValue(settingsDataState);
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const areTabsHighlighted = useRecoilValue(isHighlightedState);
    const [isDeleted, setDeleted] = useState(false);
    const [shouldHighlight, setShouldHighlight] = useState(false);
    const { style: deleteStyle, play: playDelete } = useAnimateKeyframes({ 
        duration: .7,
        keyframes: ['transform: scale(1)', 'transform: scale(0)', 'display: none'], 
        iterationCount: 1 
    });
    const { style: highlightStyle, play: playHighlight } = useAnimateKeyframes({ 
        duration: .8,
        keyframes: ['background-color: var(--bg-color);', 'background-color: var(--highlight-row-color)', 'background-color: var(--bg-color)'], 
        iterationCount: 1 
    });

    useEffect(() => {
        setShouldHighlight(props.highlightRow);
        if (shouldHighlight) playHighlight(true);
        setTimeout(() => setRowToHighlight(-1), 1000);
    });

    function _removeItemAtIndex(index) {
        return [...settingsData.slice(0, index), ...settingsData.slice(index + 1)];
    }

    async function _handleDelete() {
        const newList = _removeItemAtIndex(props.index);
        setDeleted(true);
        playDelete(true);
        await browser.storage.local.set({localTimestamp: Date.now()});
        setTimeout(async () => {setDeleted(false); await props.updateRemoteData(newList);}, 400);
    }

    function _exportCollectionToFile() {
        const element = document.createElement("a");
        const file = new Blob([JSON.stringify(props.collection)], {type: 'text/plain'});
        element.href = URL.createObjectURL(file);
        element.download = `${props.collection.name}.txt`;
        document.body.appendChild(element);
        element.click();
    }

    async function _handleUpdate() {
        let newItem = await getCurrentTabsAndGroups(props.collection.name, areTabsHighlighted);
        newItem.color = settingsData[props.index].color;
        let newSettingsData = [...settingsData];
        newSettingsData[props.index] = newItem;
        setRowToHighlight(props.index);
        playHighlight(true);
        await props.updateRemoteData(newSettingsData);
        setTimeout(() => setRowToHighlight(-1), 1000);
    }

    const _handleOpenTabs = async () => {
        const openInNewWindow = (await browser.storage.local.get('chkOpenNewWindow')).chkOpenNewWindow;
        var window;
        if (openInNewWindow) {
            window = await browser.windows.create({focused:true});
            window.tabs = await browser.tabs.query({windowId: window.id});
        } else {
            window = await browser.windows.getCurrent({populate: true, windowTypes:['normal']});   
        }
        const msg = {
            type: 'openTabs',
            collection: props.collection,
            window: window
        };
        browser.runtime.sendMessage(msg);
    }
    
    const totalGroups = props.collection.chromeGroups ? props.collection.chromeGroups.length : 0;
    let style = shouldHighlight ? highlightStyle : {};
    style = isDeleted ? deleteStyle : style;

    return <div className="row setting_row" style={style}>
        <div className="column handle">
            ⋮⋮
        </div>
        <div className="column" style={ {flex: '0 0 20px'} }>
            <div style={{position: 'relative', display: 'flex'}}><ColorPicker updateRemoteData={props.updateRemoteData} currentColor={props.collection.color} collectionIndex={props.index} /></div>
        </div>
        <div className="column settings_div" title={props.collection.name} onClick={_handleOpenTabs}>
            <span className="truncate_box">{props.collection.name}</span>
        </div>
        <div className="column total_tabs">
            {props.collection.tabs.length} tab{props.collection.tabs.length > 1 ? 's' : ''} {totalGroups > 0 && '(' + totalGroups + ' group' + (totalGroups > 1 ? 's' : '') + ')'}
        </div>
        <div className="column right_items">
            <span className="update_btn" onClick={async () => await _handleUpdate()}>update</span>
            <span title={'Export ' + props.collection.name} onClick={() => _exportCollectionToFile()} className="export">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M32.25 16.9378C31.1167 11.1878 26.0667 6.87115 20 6.87115C15.1833 6.87115 11 9.60449 8.91667 13.6045C3.9 14.1378 0 18.3878 0 23.5378C0 29.0545 4.48333 33.5378 10 33.5378H31.6667C36.2667 33.5378 40 29.8045 40 25.2045C40 20.8045 36.5833 17.2378 32.25 16.9378ZM28.3333 21.8712L20 30.2045L11.6667 21.8712H16.6667V15.2045H23.3333V21.8712H28.3333Z" fill="var(--primary-color)"/>
                </svg>
            </span>
            <span title={'Delete ' + props.collection.name} className="del" onClick={async () => await _handleDelete()}> </span>
        </div>
    </div>;
};

function NoCollections(props) {
    const themeMode = useRecoilValue(themeState);

    return <div>
        <p id='nothing_message'>You don't have any collections!<br />
        <img className='no_contant_image' src={themeMode === 'dark' ? 'images/desert-night.png' : 'images/desert.png'} alt='desert scene' /><br />
        Add the current tabs or import a collection from file.</p>
    </div>

}

function CollectionList(props) {
    const rowToHighlight = useRecoilValue(rowToHighlightState);
    const settingsData = useRecoilValue(settingsDataState);
    const [isDragging, setIsDragging] = useState(false);
    const [abortSync, setAbortSync] = useState(true);
    const [initialLoad, setInitialLoad] = useState(true);

    useEffect(() => {
        ReactTooltip.rebuild();
    },[settingsData])

    const updateTimestamp = async () => {
        setIsDragging(true)
        await browser.storage.local.set({localTimestamp: Date.now()});
    }

    const setList = async (newList) => {
        if(!isDragging && !abortSync && !initialLoad) await props.updateRemoteData(newList);
        setInitialLoad(false);
        setAbortSync(false);
    }

    const handleOnEnd = (evt) => {
        setIsDragging(false);
        setAbortSync(evt.oldIndex === evt.newIndex);
    }

    const SortType = {
        COLOR: (a,b) => (b.color > a.color) ? 1 : ((a.color > b.color) ? -1 : 0),
        DATE: (a,b) => b.createdOn - a.createdOn
    }

    const handleSort = async (sortBy) => {
        if (!settingsData || settingsData.length === 0) return;
        let newSettingsData = [...settingsData];
        newSettingsData.sort(sortBy)
        await props.updateRemoteData(newSettingsData);
    }

    return <section style={{height:'265px'}}>
        <div>
            <div className="sort-icon"/> <span className="sortLabel">Sort by: </span>
            <button className="button" onClick={async () => handleSort(SortType.COLOR)}>Color</button> 
            <button className="button" onClick={async () => handleSort(SortType.DATE)}>Newest</button>
            <div className="spacer" />
            <Switch 
                id="chkOpenNewWindow"
                textOn={<span>Tabs will open in a <strong>new window</strong></span>} 
                textOff={<span>Tabs will be added to <strong>this window</strong></span>} />
        </div>
        <div className="settings_body">
        {settingsData && settingsData.length > 0 ? (
            <ReactSortable 
                list={settingsData} 
                ghostClass="sortable_ghost" 
                handle=".handle" 
                onStart={() => setAbortSync(true)}
                onMove={() => {setAbortSync(true); return true;}}
                onSort={updateTimestamp}
                onEnd={handleOnEnd}
                setList={setList}>
                    {settingsData.map((collection, index) => (
                        <CollectionListItem 
                            key={`collection-${index}`} 
                            updateRemoteData={props.updateRemoteData} 
                            highlightRow={(index === rowToHighlight)} 
                            index={index} 
                            collection={collection} />
                    ))}
            </ReactSortable>
        ) : <NoCollections/>
        }
        </div>
        </section>;
};

export default CollectionList;