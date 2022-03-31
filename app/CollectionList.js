import React, { useState, useEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import './CollectionList.css';
import { rowToHighlightState } from './atoms/animationsState';
import { useAnimateKeyframes } from 'react-simple-animate';
import {
    isHighlightedState,
    themeState,
    searchState,
    listKeyState,
} from './atoms/globalAppSettingsState';
import { getCurrentTabsAndGroups, downloadTextFile } from './utils';
import { ReactSortable } from 'react-sortablejs';
import { browser } from '../static/globals';
import { Popover } from 'react-tiny-popover'
import ReactTooltip from 'react-tooltip';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import DeleteWithConfirmationButton from './DeleteWithConfirmationButton';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { FaTrash, FaRegCheckCircle, FaStop } from 'react-icons/fa';
import { AiOutlineFolderAdd } from 'react-icons/ai';
import { BsSearch } from 'react-icons/bs';
import { FaCloudDownloadAlt, FaVolumeMute } from 'react-icons/fa';
import { MdDeleteForever, MdOutlineOpenInNew, MdDragIndicator } from 'react-icons/md';
import { AiFillPushpin } from 'react-icons/ai';

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
    }, [props.currentColor]);

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
        positions={['right']} // preferred positions by priority
        onClickOutside={handleClose}
        content={
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
            </div>}
    >
        <div onClick={handleClick} className="colorPickerWrapper" data-tip-disable={showPicker} data-tip={props.tooltip}>
            <div className="colorPicker" style={{ borderColor: color === 'var(--bg-color)' ? 'var(--settings-row-text-color)' : color }} onClick={handleClick}>
                <div className="currentColor" style={{ backgroundColor: color }} />
            </div>
        </div>
    </Popover>;
}

function CollectionListItem(props) {
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const areTabsHighlighted = useRecoilValue(isHighlightedState);
    const [isDeleted, setDeleted] = useState(false);
    const [collectionName, setCollectionName] = useState(props.collection.name);
    const [isExpanded, setExpanded] = useState(false);
    const [shouldHighlight, setShouldHighlight] = useState(false);
    const [isAutoUpdate, setIsAutoUpdate] = useState(false);
    const setListKey = useSetRecoilState(listKeyState);
    const [openSnackbar] = useSnackbar({ style: collectionName === '' ? SnackbarStyle.ERROR : SnackbarStyle.SUCCESS });
    const [openUpdateSnackbar, closeUpdateSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: { display: 'none' } });
    const [, closeDeleteSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: { display: 'none' } });

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

    useEffect(async () => {
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack') || [];
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(props.collection.uid);
        setIsAutoUpdate(chkEnableAutoUpdate && collectionIsActive);
    }, [props.collection])

    const handleSaveCollectionColor = async (color) => {
        let newCollectionItem = { ...props.collection };
        newCollectionItem.color = color;
        await props.updateCollection(props.index, newCollectionItem);
    }

    async function _handleDelete() {
        const { tabsArray: previousCollections } = await browser.storage.local.get('tabsArray');
        setExpanded(false);
        _handleStopTracking();
        const newList = props.removeCollectionAtIndex(props.index);
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
        downloadTextFile(JSON.stringify(props.collection), props.collection.name);
    }

    async function _handleUpdate() {
        const { tabsArray: previousCollections } = await browser.storage.local.get('tabsArray');
        let newItem = await getCurrentTabsAndGroups(props.collection.name, areTabsHighlighted);
        newItem.color = props.collection.color;
        await props.updateCollection(props.index, newItem);
        setRowToHighlight(props.index);
        playHighlight(true);
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
        if (isAutoUpdate) { 
            await _handleFocusWindow(); 
            return;
        }
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
        await browser.runtime.sendMessage(msg);
        setTimeout(() => setListKey(Math.random().toString()), 500);
    }

    const _handleExpand = () => {
        setExpanded(!isExpanded);
        setCollectionName(props.collection.name)
    }

    const _handleFocusWindow = async () => {
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack') || [];
        const activeWindowId = collectionsToTrack.find(c => c.collectionUid === props.collection.uid)?.windowId;
        if (!activeWindowId) return;
        const msg = {
            type: 'focusWindow',
            windowId: activeWindowId
        };
        browser.runtime.sendMessage(msg);
    }

    const _handleStopTracking = async () => {
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack') || [];
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(props.collection.uid);
        if (!collectionIsActive) return;
        const newCollectionsToTrack = collectionsToTrack.filter(c => c.collectionUid !== props.collection.uid);
        await browser.storage.local.set({ collectionsToTrack: newCollectionsToTrack });
        setIsAutoUpdate(false);
    }

    const handleCollectionNameChange = (val) => {
        setCollectionName(val.trim());
        if (val.trim() === "") {
            openSnackbar("Please enter a name for the collection", 4000);
            setCollectionName(props.collection.name);
            return;
        }
        let currentCollection = { ...props.collection };
        currentCollection.name = val;
        props.updateCollection(props.index, currentCollection);
        openSnackbar(`Collection name updated to '${val}'!`, 5000);
    }

    const totalGroups = props.collection.chromeGroups ? props.collection.chromeGroups.length : 0;
    let style = shouldHighlight ? highlightStyle : {};
    style = isDeleted ? deleteStyle : style;

    return <div className={`row setting_row ${isAutoUpdate && 'active-auto-tracking'}`} style={{ ...style, backgroundColor: isExpanded ? 'var(--setting-row-hover-bg-color)' : null }}>
        <div
            className="column handle"
            data-tip={props.disableDrag ? "Drag & Drop is disabled when searching" : null}
            data-place={'top'}
            data-class="small-tooltip">
            <MdDragIndicator />
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
        <div
            className="column settings_div"
            title={props.collection.name}
            onClick={async () => await _handleOpenTabs()}
        >
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
            <span 
                data-tip="Stop auto updating this collection"
                className={`float-button ${isAutoUpdate ? 'stop_btn' : 'update_btn'}`} 
                onClick={async () => isAutoUpdate ? _handleStopTracking() : await _handleUpdate()}
            >
                {isAutoUpdate ? <FaStop /> : 'update'}
            </span>
            <span title={'Export ' + props.collection.name} onClick={() => _exportCollectionToFile()} className="export">
                <FaCloudDownloadAlt color="var(--primary-color)" size="40" />
            </span>
            <span title={'Delete ' + props.collection.name} className="export" onClick={async () => await _handleDelete()}>
                <MdDeleteForever color="#e74c3c" size="40" />
            </span>
            <span className={`expand-icon ${isExpanded ? 'expan-open' : ''}`} title={`${isExpanded ? 'Collapse' : 'Expand'} list of tabs`} onClick={() => _handleExpand()}>⌃</span>
        </div>
        {isExpanded ? <ExpandedCollectionData
            collectionIndex={props.index}
            collection={props.collection}
            updateCollection={props.updateCollection}
            updateRemoteData={props.updateRemoteData} /> : null}
    </div>;
}

function ExpandedCollectionData(props) {
    const [openSnackbar, closeSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: { display: 'none' } });
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
        let currentCollection = { ...props.collection };
        const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === group.uid);
        let chromeGroups = [...currentCollection.chromeGroups];
        let chromeGrp = { ...chromeGroups[grpIndex] }
        chromeGrp[attr] = val;
        chromeGroups[grpIndex] = chromeGrp;
        currentCollection.chromeGroups = chromeGroups;
        props.updateCollection(props.collectionIndex, currentCollection);
    }
    const getColorName = (value) => Object.keys(colorChart).find(key => colorChart[key] === value);
    const handleSaveGroupColor = async (color, group) => _updateGroupAttribute(group, 'color', getColorName(color));
    const saveGroupName = (title, group) => _updateGroupAttribute(group, 'title', title);

    const getColorCode = (name) => {
        const _name = name.toLowerCase();
        return (_name in colorChart) ? colorChart[_name] : name;
    }

    const _handleDeleteGroup = (groupUid) => {
        let currentCollection = { ...props.collection };
        const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === groupUid);
        let chromeGroups = [...currentCollection.chromeGroups];
        chromeGroups.splice(grpIndex, 1);
        let tabs = [...currentCollection.tabs];
        currentCollection.tabs = tabs.filter(el => el.groupUid !== groupUid);
        currentCollection.chromeGroups = chromeGroups;
        props.updateCollection(props.collectionIndex, currentCollection);
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
        let currentCollection = { ...props.collection };
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
        props.updateCollection(props.collectionIndex, currentCollection);
    }

    const handleFaviconError = (e) => {
        e.target.src = fallbackFavicon;
    }

    const handleOpenTab = async (tab) => {
        const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
        if (chkOpenNewWindow) {
            await browser.windows.create({ focused: true, url: tab.url });
        } else {
            await browser.tabs.create({ url: tab.url, active: true });
        }
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
        const { tabsArray: previousCollections } = await browser.storage.local.get('tabsArray');
        let currentCollection = { ...props.collection };
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
        props.updateCollection(props.collectionIndex, currentCollection);
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
            {(tab.groupId > -1) ? 
                <div 
                    className="group-indicator" 
                    style={{ 
                        backgroundColor: groupFromId(tab.groupUid) ? getColorCode(groupFromId(tab.groupUid).color) : 'transparent', 
                        boxShadow: groupFromId(tab.groupUid) ? `${getColorCode(groupFromId(tab.groupUid).color)} -3px 1px 3px -2px` : 'none'
                    }} /> : 
                <div className="group-placeholder" />}
            {tab.pinned ? <div className="tab-property pinned-tab" title="Pinned Tab">
                <AiFillPushpin size="12px" color="#FFF" />
            </div> : null}
            {tab.mutedInfo.muted ? <div className="tab-property muted-tab" title="Muted Tab">
                <FaVolumeMute color="#fff" size="14px" />
            </div> : null}
            <div className="column favicon-col">
                <img onError={handleFaviconError} className="tab-favicon" src={tab.favIconUrl ? tab.favIconUrl : /\.(jpg|jpeg|gif|png|ico|tiff)$/.test(tab.url.split('?')[0]) ? tab.url : fallbackFavicon} />
            </div>
            <div className="column single-tab-title-col">
                <span className="single-tab-title" title={tab.title}>{tab.title}</span>
            </div>
            <div className="column actions-col">
                <button className="action-button" title="Open this tab" onClick={async () => await handleOpenTab(tab)}>
                    <MdOutlineOpenInNew size="16px" color="var(--primary-color)" />
                </button>
                <button className="action-button del-tab" title="Delete this tab" onClick={() => handleTabDelete(index)}>
                    <MdDeleteForever color="#B64A4A" size="20" />
                </button>
            </div>
        </div>])}
    </div>
}

function SearchTitle({ searchTerm }) {
    return <h2 className="search-title"><BsSearch size="14" /> &nbsp;Showing results for: <strong>{searchTerm}</strong></h2>
}

function NoCollections() {
    const themeMode = useRecoilValue(themeState);
    const search = useRecoilValue(searchState);

    return !search ? <div>
        <p id='nothing_message'>You don&apos;t have any collections!<br />
            <img className='no_contant_image' src={themeMode === 'dark' ? 'images/desert-night.png' : 'images/desert.png'} alt='desert scene' /><br />
            Add the current tabs or import a collection from file.</p>
    </div> : <div>
        <p id='nothing_message'>There are no collections that match your search.<br />
        </p>
    </div>
}

function CollectionList({
    collections,
    ...props
}) {
    const rowToHighlight = useRecoilValue(rowToHighlightState);
    const [isDragging, setIsDragging] = useState(false);
    const [abortSync, setAbortSync] = useState(true);
    const [initialLoad, setInitialLoad] = useState(true);
    const search = useRecoilValue(searchState);
    const [disableDrag, setDisableDrag] = useState(false);

    useEffect(() => {
        ReactTooltip.rebuild();
    }, [collections])

    useEffect(() => {
        setDisableDrag(search !== undefined && search !== '');
    }, [search])

    const updateTimestamp = async () => {
        setIsDragging(true)
        await browser.storage.local.set({ localTimestamp: Date.now() });
    }

    const setList = async (newList) => {
        if (!isDragging && !abortSync && !initialLoad && !disableDrag) await props.updateRemoteData(newList);
        setInitialLoad(false);
        setAbortSync(false);
    }

    const handleOnEnd = (evt) => {
        setIsDragging(false);
        setAbortSync(evt.oldIndex === evt.newIndex);
    }

    return <section className="settings_body">
        {search ? <SearchTitle searchTerm={search} /> : null}
        {collections && collections.length > 0 ? (
            <ReactSortable
                list={collections.map((c) => ({ ...c }))}
                id={`collection-list-${disableDrag}`}
                key={`collection-list-${disableDrag}`}
                disabled={disableDrag}
                ghostClass="sortable_ghost"
                handle=".handle"
                onStart={() => setAbortSync(true)}
                onMove={() => { setAbortSync(true); return !disableDrag; }}
                onSort={updateTimestamp}
                onEnd={handleOnEnd}
                setList={setList}>
                {collections.map((collection, index) => (
                    <CollectionListItem
                        key={`collection-${index}`}
                        updateRemoteData={props.updateRemoteData}
                        highlightRow={(index === rowToHighlight)}
                        expanded={false}
                        disableDrag={disableDrag}
                        index={index}
                        updateCollection={props.updateCollection}
                        removeCollectionAtIndex={props.removeCollectionAtIndex}
                        collection={collection} />
                ))}
            </ReactSortable>
        ) : <NoCollections />
        }
    </section>;
}

export default CollectionList;