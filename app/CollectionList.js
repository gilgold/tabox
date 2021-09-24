import React, { useState, useEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import './CollectionList.css';
import { settingsDataState } from './atoms/settingsDataState';
import { rowToHighlightState } from './atoms/animationsState';
import { useAnimateKeyframes } from 'react-simple-animate';
import {
    isHighlightedState,
    themeState,
} from './atoms/globalAppSettingsState';
import { getCurrentTabsAndGroups } from './utils';
import { ReactSortable } from 'react-sortablejs';
import { browser } from '../static/globals';
import Popover from 'react-popover';
import ReactTooltip from 'react-tooltip';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import DeleteWithConfirmationButton from './DeleteWithConfirmationButton';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { FaTrash, FaRegCheckCircle } from 'react-icons/fa';
import { AiOutlineFolderAdd } from 'react-icons/ai';


const UNDO_TIME = 10;


if (typeof Array.prototype.move === "undefined") {
    Array.prototype.move = function (from, to, on = 1) {
        return this.splice(to, 0, ...this.splice(from, on)), this
    }
}


function ColorPicker(props) {

    const [color, setColor] = useState(props?.currentColor ?? 'var(--bg-color)');
    const [showPicker, setShowPicker] = useState(false);
    const [selectedColorCircle, setSelectedColorCircle] = useState(0);
    const settingsData = useRecoilValue(settingsDataState);

    const colorList = props.colorList ?? [
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
    ];

    useEffect(() => {
        setColor(props?.currentColor ?? 'var(--bg-color)')
        if (props.currentColor) {
            const colorIndex = colorList.findIndex(element => element === props.currentColor);
            setSelectedColorCircle(colorIndex);
        }
    }, [settingsData]);

    useEffect(() => ReactTooltip.rebuild(), []);

    const handleChange = async (color, index) => {
        setColor(color);
        setSelectedColorCircle(index);
        props.action(color, props.group ?? null);

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
                {colorList.map((_color, index) => index === 8 ?
                    <div className="break" key={'breaker'} /> :
                    <div
                        key={`color-${index}`}
                        onClick={async () => await handleChange(_color, index)}
                        className={`colorOption`}
                        style={{ backgroundColor: _color }}>
                        <div className={`selectedInnerCircle ${index === selectedColorCircle ? 'selected' : ''}`} />
                    </div>
                )}
            </div>
        }
        children={
            <div onClick={handleClick} className="colorPickerWrapper" data-tip-disable={showPicker} data-tip={props.tooltip}>
                <div className="colorPicker" style={{ borderColor: color === 'var(--bg-color)' ? 'var(--settings-row-text-color)' : color }} onClick={handleClick}>
                    <div className="currentColor" style={{ backgroundColor: color }} />
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
    const [collectionName, setCollectionName] = useState(props.collection.name);
    const [isExpanded, setExpanded] = useState(false);
    const [shouldHighlight, setShouldHighlight] = useState(false);
    const [openSnackbar, closeSnackbar] = useSnackbar({ style: collectionName === '' ? SnackbarStyle.ERROR : SnackbarStyle.SUCCESS });
    const [openUpdateSnackbar, closeUpdateSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: {display: 'none'} });
    const [openDeleteSnackbar, closeDeleteSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: {display: 'none'} });

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
        if (props.highlightRow) {
            setExpanded(false);
        }
        setShouldHighlight(props.highlightRow);
        if (shouldHighlight) playHighlight(true);
        setTimeout(() => setRowToHighlight(-1), 1000);
    });

    const handleSaveCollectionColor = async (color) => {
        let newSettingsData = [...settingsData];
        let newCollectionItem = { ...newSettingsData[props.index] };
        newCollectionItem.color = color;
        newSettingsData[props.index] = newCollectionItem;
        await props.updateRemoteData(newSettingsData);
    }

    function _removeItemAtIndex(index) {
        return [...settingsData.slice(0, index), ...settingsData.slice(index + 1)];
    }

    async function _handleDelete() {
        const previousCollections = [...settingsData];
        setExpanded(false);
        const newList = _removeItemAtIndex(props.index);
        setDeleted(true);
        playDelete(true);
        await browser.storage.local.set({ localTimestamp: Date.now() });
        setTimeout(async () => { setDeleted(false); await props.updateRemoteData(newList); }, 400);
        openUpdateSnackbar(
            <SnackBarWithUndo
                icon={<FaTrash />}
                message={`Collection deleted successfully`}
                collectionName={props.collection.name}
                updateRemoteData={props.updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeDeleteSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
    }

    function _exportCollectionToFile() {
        const element = document.createElement("a");
        const file = new Blob([JSON.stringify(props.collection)], { type: 'text/plain' });
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
        const previousCollections = [...settingsData];
        await props.updateRemoteData(newSettingsData);
        setTimeout(() => setRowToHighlight(-1), 1000);
        openUpdateSnackbar(
            <SnackBarWithUndo
                icon={<FaRegCheckCircle />}
                message={`Collection updated successfully`}
                collectionName={props.collection.name}
                updateRemoteData={props.updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeUpdateSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
    }

    const _handleOpenTabs = async () => {
        if (isExpanded) return;
        const openInNewWindow = (await browser.storage.local.get('chkOpenNewWindow')).chkOpenNewWindow;
        var window;
        if (openInNewWindow) {
            const hasWindowProp = 'window' in props.collection && props.collection.window;
            window = await browser.windows.create({ 
                focused: true, 
                left: hasWindowProp ? props.collection.window.left : null, 
                top: hasWindowProp ? props.collection.window.top : null, 
                width: hasWindowProp ? props.collection.window.width : null, 
                height: hasWindowProp ? props.collection.window.height : null
            });
            window.tabs = await browser.tabs.query({ windowId: window.id });
        } else {
            window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
        }
        const msg = {
            type: 'openTabs',
            collection: props.collection,
            window: window
        };
        browser.runtime.sendMessage(msg);
    }

    const _handleExpand = () => {
        setExpanded(!isExpanded);
        setCollectionName(props.collection.name)
    }

    const handleCollectionNameChange = (val, collection) => {
        setCollectionName(val.trim());
        if (val.trim() === "") {
            openSnackbar("Please enter a name for the collection", 4000);
            setCollectionName(collection.name);
            return;
        }
        let newSettingsData = [...settingsData];
        let currentCollection = { ...newSettingsData[props.index] };
        currentCollection.name = val;
        newSettingsData[props.index] = currentCollection;
        props.updateRemoteData(newSettingsData);
        openSnackbar(`Collection name updated to '${val}'!`, 5000);
    }

    const totalGroups = props.collection.chromeGroups ? props.collection.chromeGroups.length : 0;
    let style = shouldHighlight ? highlightStyle : {};
    style = isDeleted ? deleteStyle : style;

    return <div className="row setting_row" style={{ ...style, backgroundColor: isExpanded ? 'var(--setting-row-hover-bg-color)' : null }}>
        <div className="column handle">
            ⋮⋮
        </div>
        <div className="column" style={{ flex: '0 0 20px' }}>
            <div style={{ position: 'relative', display: 'flex' }}>
                <ColorPicker
                    currentColor={props.collection.color}
                    tooltip="Choose a color for this collection"
                    collectionIndex={props.index}
                    action={handleSaveCollectionColor} />
            </div>
        </div>
        <div className="column settings_div" title={props.collection.name} onClick={_handleOpenTabs}>
            <span className="truncate_box">{isExpanded ? <div className="edit-collection-wrapper">
                <AutoSaveTextbox
                    onChange={setCollectionName}
                    maxLength={50}
                    initValue={props.collection.name}
                    item={props.collection}
                    action={handleCollectionNameChange} />
            </div> : props.collection.name}</span>
        </div>
        <div className="column total_tabs" onClick={_handleOpenTabs}>
            {props.collection.tabs.length} tab{props.collection.tabs.length > 1 ? 's' : ''} {totalGroups > 0 && '(' + totalGroups + ' group' + (totalGroups > 1 ? 's' : '') + ')'}
        </div>
        <div className="column right_items">
            <span className="update_btn" onClick={async () => await _handleUpdate()}>update</span>
            <span title={'Export ' + props.collection.name} onClick={() => _exportCollectionToFile()} className="export">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M32.25 16.9378C31.1167 11.1878 26.0667 6.87115 20 6.87115C15.1833 6.87115 11 9.60449 8.91667 13.6045C3.9 14.1378 0 18.3878 0 23.5378C0 29.0545 4.48333 33.5378 10 33.5378H31.6667C36.2667 33.5378 40 29.8045 40 25.2045C40 20.8045 36.5833 17.2378 32.25 16.9378ZM28.3333 21.8712L20 30.2045L11.6667 21.8712H16.6667V15.2045H23.3333V21.8712H28.3333Z" fill="var(--primary-color)" />
                </svg>
            </span>
            <span title={'Delete ' + props.collection.name} className="del" onClick={async () => await _handleDelete()}> </span>
            <span className={`expand-icon ${isExpanded ? 'expan-open' : ''}`} title={`${isExpanded ? 'Collapse' : 'Expand'} list of tabs`} onClick={() => _handleExpand()}>⌃</span>
        </div>
        {isExpanded ? <ExpandedCollectionData
            collectionIndex={props.index}
            collection={props.collection}
            updateRemoteData={props.updateRemoteData} /> : null}
    </div>;
};

function ExpandedCollectionData(props) {

    const settingsData = useRecoilValue(settingsDataState);
    const [openSnackbar, closeSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: {display: 'none'} });
    const isHighlighted = useRecoilValue(isHighlightedState);

    let previousGroupUid = null;
    const fallbackFavicon = './images/favicon-fallback.png';

    const groupFromId = (_id, groups = props.collection.chromeGroups) => {
        return groups.find(el => el.uid === _id);
    }

    const colorChart = {
        'grey': '#54585d',
        'blue': '#1b68de',
        'red': '#d22c28',
        'yellow': '#fcd065',
        'green': '#21823d',
        'pink': '#fd80c2',
        'purple': '#872fdb',
        'cyan': '#6fd3e7'
    }

    const _updateGroupAttribute = (group, attr, val) => {
        let newSettingsData = [...settingsData];
        let currentCollection = { ...newSettingsData[props.collectionIndex] };
        const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === group.uid);
        let chromeGroups = [...currentCollection.chromeGroups];
        let chromeGrp = { ...chromeGroups[grpIndex] }
        chromeGrp[attr] = val;
        chromeGroups[grpIndex] = chromeGrp;
        currentCollection.chromeGroups = chromeGroups;
        newSettingsData[props.collectionIndex] = currentCollection;
        props.updateRemoteData(newSettingsData);
    }
    const getColorName = (value) => Object.keys(colorChart).find(key => colorChart[key] === value);
    const handleSaveGroupColor = async (color, group) => _updateGroupAttribute(group, 'color', getColorName(color));
    const saveGroupName = (title, group) => _updateGroupAttribute(group, 'title', title);

    const getColorCode = (name) => {
        const _name = name.toLowerCase();
        return (_name in colorChart) ? colorChart[_name] : name;
    }

    const _handleDeleteGroup = (groupUid) => {
        let newSettingsData = [...settingsData];
        let currentCollection = { ...newSettingsData[props.collectionIndex] };
        const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === groupUid);
        let chromeGroups = [...currentCollection.chromeGroups];
        chromeGroups.splice(grpIndex, 1);
        let tabs = [...currentCollection.tabs];
        currentCollection.tabs = tabs.filter(el => el.groupUid !== groupUid);
        currentCollection.chromeGroups = chromeGroups;
        newSettingsData[props.collectionIndex] = currentCollection;
        props.updateRemoteData(newSettingsData);
    }

    const GroupHeader = (groupUid) => {
        if (groupUid && groupUid !== previousGroupUid) {
            previousGroupUid = groupUid;
            const group = groupFromId(groupUid);
            return group ? <div className="group-wrapper" key={`group-wrapper-${groupUid}`}>
                <div className="group-header" key={`group-${groupUid}`}>
                <div className="tree-line" />
                <div className="group-header-title" style={{ boxShadow: `0 0 2px 2px ${getColorCode(group.color)}` }}>
                    <AutoSaveTextbox
                        initValue={group.title}
                        item={group}
                        action={saveGroupName} />
                    <ColorPicker
                        colorList={Object.values(colorChart)}
                        tooltip="Choose a color for this group"
                        group={group}
                        currentColor={getColorCode(group.color)}
                        action={handleSaveGroupColor} />
                </div>
            </div>
                <div className="group-header-actions" key={`group-actions-${groupUid}`}>
                    <DeleteWithConfirmationButton 
                        action={_handleDeleteGroup}
                        group={group}
                    />
                </div>
            </div> : null;
        }
    }

    function _removeItemAtIndex(tabs, index) {
        return [...tabs.slice(0, index), ...tabs.slice(index + 1)];
    }

    const handleTabDelete = (index) => {
        let newSettingsData = [...settingsData];
        let currentCollection = { ...newSettingsData[props.collectionIndex] };
        let newTabList = _removeItemAtIndex(currentCollection.tabs, index);
        const groupUid = currentCollection.tabs[index].groupUid;
        let newChromeGroups = [...currentCollection.chromeGroups];
        if (groupUid) {
            const totalTabsInGroup = newTabList.filter(el => el.groupUid === groupUid).length;
            if (totalTabsInGroup === 0) {
                newChromeGroups = _removeItemAtIndex(newChromeGroups, newChromeGroups.findIndex(el => el.uid === groupUid));
            }
        }
        currentCollection.tabs = newTabList;
        currentCollection.chromeGroups = newChromeGroups;
        newSettingsData[props.collectionIndex] = currentCollection;
        props.updateRemoteData(newSettingsData);
    }

    const handleFaviconError = (e) => {
        e.target.src = fallbackFavicon;
    }

    const handleOpenTab = async (tab) => {
        await browser.windows.create({ focused: true, url: tab.url });
    }

    const _groupsAreSimilar = (group1, group2) => {
        return group1 && group2 && group1.name === group2.name && group1.color === group2.color;
    }

    const groupExistsInCollection = (group) => {
        return group ? props.collection.chromeGroups.findIndex(el => _groupsAreSimilar(el, group)) > -1 : false;
    }

    const _updateCollectionTabs = async (onlyHighlighted) => {
        const { chkColEditIgnoreDuplicateTabs } = await browser.storage.local.get('chkColEditIgnoreDuplicateTabs');
        const { chkColEditIgnoreDuplicateGroups } = await browser.storage.local.get('chkColEditIgnoreDuplicateGroups');
        const previousCollections = [...settingsData];
        let newSettingsData = [...settingsData];
        let currentCollection = { ...newSettingsData[props.collectionIndex] };
        let newCollection = await getCurrentTabsAndGroups('', onlyHighlighted);
        let newCollectionTabs = [...newCollection.tabs];
        let newCollectionGroups = [...newCollection.chromeGroups];
        if (chkColEditIgnoreDuplicateTabs) {
            newCollectionTabs = newCollectionTabs.filter(tab => currentCollection.tabs.findIndex(el => el.url === tab.url) === -1);
        }
        let updatedTabs = [...currentCollection.tabs];
        let totalTabsAdded = updatedTabs.length;
        if (chkColEditIgnoreDuplicateGroups) {
            for (let index = 0; index < newCollectionTabs.length; index++) {
                let tab = { ...newCollectionTabs[index] };
                if ('groupUid' in tab) {
                    const group = groupFromId(tab.groupUid, newCollectionGroups);
                    if (group && groupExistsInCollection(group)) {
                        tab.groupUid = currentCollection.chromeGroups.find(el => _groupsAreSimilar(el, group)).uid;
                        const insertIndex = updatedTabs.findIndex(el => ('groupUid' in el) && _groupsAreSimilar(groupFromId(el.groupUid), group));
                        const count = updatedTabs.filter(el => ('groupUid' in el) && _groupsAreSimilar(groupFromId(el.groupUid), group)).length;
                        updatedTabs.splice(insertIndex + count, 0, tab);
                    }
                }
            }
            newCollectionTabs = newCollectionTabs.filter(tab => !('groupUid' in tab) || !groupExistsInCollection(groupFromId(tab.groupUid, newCollectionGroups)));
            newCollectionGroups = newCollectionGroups.filter(group => !groupExistsInCollection(group));
        }

        currentCollection.tabs = [...updatedTabs, ...newCollectionTabs];
        totalTabsAdded = currentCollection.tabs.length - totalTabsAdded;
        currentCollection.chromeGroups = [...currentCollection.chromeGroups, ...newCollectionGroups];
        newSettingsData[props.collectionIndex] = currentCollection;
        props.updateRemoteData(newSettingsData);
        openSnackbar(
            <SnackBarWithUndo
                icon={<AiOutlineFolderAdd size="32px" />}
                message={`${totalTabsAdded} ${totalTabsAdded === 1 ? 'tab' : 'tabs'} added to collection.`}
                collectionName={props.collection.name}
                updateRemoteData={props.updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
    }

    const handleAddSelectedTabs = async () => {
        await _updateCollectionTabs(true);
    }

    const handleAddAllTabs = async () => {
        await _updateCollectionTabs(false);
    }

    return <div className={`expanded-wrapper`}>
        <div className="add-tab-wrapper">
            <div className="tree-line"></div>
            <div
                className="add-tab-button"
                data-tip={`Add ${isHighlighted ? 'selected tabs' : 'the current tab'} to this collection`}
                data-place={'top'}
                data-class="small-tooltip"
                onClick={handleAddSelectedTabs}>
                <div className="plus-icon">+</div> Add {isHighlighted ? 'selected tabs' : 'current tab'}
            </div>
            <div
                className="add-tab-button"
                data-tip="Add all tabs from this window to this collection"
                data-class="small-tooltip"
                data-place={'top'} onClick={handleAddAllTabs}>
                <div className="multi-plus-icon">+</div> Add all open tabs
            </div>
        </div>
        {props.collection.tabs.map((tab, index) => [GroupHeader(tab.groupUid), <div className="row single-tab-row" key={`line-${index}`}>
            <div className="tree-line"></div>
            {(tab.groupId > -1) ? <div className="group-indicator" style={{ backgroundColor: groupFromId(tab.groupUid) ? getColorCode(groupFromId(tab.groupUid).color) : 'transparent' }} /> : <div className="group-placeholder" />}
            {tab.pinned ? <div className="tab-property" title="Pinned Tab">
                <svg width="7" height="11" viewBox="0 0 7 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0.170732 0H3.41463H6.82927C6.92356 0 7 0.081245 7 0.181466V0.907329C7 0.971071 6.96853 1.03014 6.91711 1.06293L6.89236 1.07872C6.42953 1.37387 5.80487 1.17962 5.80487 1.7533V3.60551C5.84729 3.6596 7.01198 5.00157 6.98388 5.06534C6.95578 5.1291 6.89551 5.16983 6.82927 5.16983H4.26829V6.98061C4.26829 6.9892 4.26772 6.99778 4.26658 7.00628L3.5 11L2.73342 7.00628C2.73228 6.99778 2.73171 6.9892 2.73171 6.98061V5.16983H0.170732C0.104485 5.16983 0.044218 5.1291 0.0161188 5.06534C-0.0119802 5.00157 1.15271 3.6596 1.19512 3.60551V1.7533C1.19512 1.17962 0.570467 1.37387 0.10764 1.07872L0.0828909 1.06293C0.0314658 1.03014 0 0.971071 0 0.907329V0.181466C0 0.081245 0.0764393 0 0.170732 0Z" fill="#C80836" />
                </svg>
            </div> : null}
            {tab.mutedInfo.muted ? <div className="tab-property" title="Muted Tab">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 5.0625V9.9375H4.11111L8 14V1L4.11111 5.0625H1Z" fill="#878787" />
                    <path d="M12.5654 10C12.5121 10 12.4614 9.992 12.4134 9.976C12.3654 9.96 12.3201 9.92533 12.2774 9.872L10.8774 8.192L10.5894 7.904L9.19744 6.256C9.1281 6.17067 9.09077 6.08 9.08544 5.984C9.0801 5.88267 9.10677 5.79733 9.16544 5.728C9.2241 5.65867 9.3121 5.624 9.42944 5.624C9.55744 5.624 9.65877 5.66933 9.73344 5.76L11.1014 7.392L11.3094 7.584L12.8134 9.384C12.8934 9.48 12.9308 9.576 12.9254 9.672C12.9254 9.76267 12.8908 9.84 12.8214 9.904C12.7574 9.968 12.6721 10 12.5654 10ZM9.50944 10C9.40277 10 9.31744 9.968 9.25344 9.904C9.19477 9.83467 9.16544 9.752 9.16544 9.656C9.16544 9.56 9.20277 9.464 9.27744 9.368L10.6374 7.664L11.0694 8.272L9.79744 9.872C9.71744 9.95733 9.62144 10 9.50944 10ZM11.4854 7.944L10.9334 7.472L12.2214 5.76C12.2641 5.70667 12.3094 5.672 12.3574 5.656C12.4054 5.63467 12.4588 5.624 12.5174 5.624C12.6348 5.624 12.7228 5.66133 12.7814 5.736C12.8401 5.80533 12.8668 5.89067 12.8614 5.992C12.8614 6.09333 12.8241 6.192 12.7494 6.288L11.4854 7.944Z" fill="#878787" />
                </svg>
            </div> : null}
            <div className="column favicon-col">
                <img onError={handleFaviconError} className="tab-favicon" src={tab.favIconUrl ? tab.favIconUrl : /\.(jpg|jpeg|gif|png|ico|tiff)$/.test(tab.url.split('?')[0]) ? tab.url : fallbackFavicon} />
            </div>
            <div className="column single-tab-title-col">
                <span className="single-tab-title" title={tab.title}>{tab.title}</span>
            </div>
            <div className="column actions-col">
                <button className="action-button" title="Open this tab in a new window" onClick={async () => await handleOpenTab(tab)}>
                    <svg fill="var(--primary-color)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="16px" height="16px"><path d="M 84 11 C 82.3 11 81 12.3 81 14 C 81 15.7 82.3 17 84 17 L 106.80078 17 L 60.400391 63.400391 C 59.200391 64.600391 59.200391 66.499609 60.400391 67.599609 C 61.000391 68.199609 61.8 68.5 62.5 68.5 C 63.2 68.5 63.999609 68.199609 64.599609 67.599609 L 111 21.199219 L 111 44 C 111 45.7 112.3 47 114 47 C 115.7 47 117 45.7 117 44 L 117 14 C 117 12.3 115.7 11 114 11 L 84 11 z M 24 31 C 16.8 31 11 36.8 11 44 L 11 104 C 11 111.2 16.8 117 24 117 L 84 117 C 91.2 117 97 111.2 97 104 L 97 59 C 97 57.3 95.7 56 94 56 C 92.3 56 91 57.3 91 59 L 91 104 C 91 107.9 87.9 111 84 111 L 24 111 C 20.1 111 17 107.9 17 104 L 17 44 C 17 40.1 20.1 37 24 37 L 69 37 C 70.7 37 72 35.7 72 34 C 72 32.3 70.7 31 69 31 L 24 31 z" /></svg>
                </button>
                <button className="action-button del" title="Delete this tab" onClick={() => handleTabDelete(index)} />
            </div>
        </div>])}
    </div>
}

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
    }, [settingsData])

    const updateTimestamp = async () => {
        setIsDragging(true)
        await browser.storage.local.set({ localTimestamp: Date.now() });
    }

    const setList = async (newList) => {
        if (!isDragging && !abortSync && !initialLoad) await props.updateRemoteData(newList);
        setInitialLoad(false);
        setAbortSync(false);
    }

    const handleOnEnd = (evt) => {
        setIsDragging(false);
        setAbortSync(evt.oldIndex === evt.newIndex);
    }

    return <section className="settings_body">
        {settingsData && settingsData.length > 0 ? (
            <ReactSortable
                list={settingsData}
                ghostClass="sortable_ghost"
                handle=".handle"
                onStart={() => setAbortSync(true)}
                onMove={() => { setAbortSync(true); return true; }}
                onSort={updateTimestamp}
                onEnd={handleOnEnd}
                setList={setList}>
                {settingsData.map((collection, index) => (
                    <CollectionListItem
                        key={`collection-${index}`}
                        updateRemoteData={props.updateRemoteData}
                        highlightRow={(index === rowToHighlight)}
                        expanded={false}
                        index={index}
                        collection={collection} />
                ))}
            </ReactSortable>
        ) : <NoCollections />
        }
    </section>;
};

export default CollectionList;