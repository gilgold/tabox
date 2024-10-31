import React, { useEffect, useState } from 'react';
import { MdDragIndicator, MdDeleteForever } from 'react-icons/md';
import { FaCloudDownloadAlt, FaStop, FaTrash, FaRegCheckCircle } from 'react-icons/fa';
import { useSetRecoilState } from 'recoil';
import { rowToHighlightState } from './atoms/animationsState';
import { listKeyState } from './atoms/globalAppSettingsState';
import { downloadTextFile, getCurrentTabsAndGroups } from './utils';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { useAnimateKeyframes } from 'react-simple-animate';
import ExpandedCollectionData from './ExpandedCollectionData';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import ColorPicker from './ColorPicker';
import { UNDO_TIME } from './constants';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { browser } from '../static/globals';

function CollectionListItem(props) {
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const [isDeleted, setDeleted] = useState(false);
    const [collectionName, setCollectionName] = useState(props.collection.name);
    const [isExpanded, setExpanded] = useState(false);
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
        let timer;
        if (props.highlightRow) {
            setExpanded(false);
            playHighlight(true);
            timer = setTimeout(() => setRowToHighlight(-1), 1000);
        }
        return () => {
            setRowToHighlight(-1);
            playHighlight(false);
            clearTimeout(timer);
        };
    }, [props.collection]);

    useEffect(async () => {
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        if (!collectionsToTrack || collectionsToTrack == {}) return;
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(props.collection.uid);
        setIsAutoUpdate(chkEnableAutoUpdate && collectionIsActive);
    }, [props.collection]);

    const handleSaveCollectionColor = async (color) => {
        let newCollectionItem = { ...props.collection };
        newCollectionItem.color = color;
        await props.updateCollection(newCollectionItem);
    }

    const _handleDelete = async () => {
        const { tabsArray: previousCollections } = await browser.storage.local.get('tabsArray');
        setExpanded(false);
        await _handleStopTracking();
        const newList = props.removeCollection(props.collection.uid);
        setDeleted(true);
        playDelete(true);
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

    const _exportCollectionToFile = () => {
        downloadTextFile(JSON.stringify(props.collection), props.collection.name);
    }

    const isWithinDisplayBounds = async (collection) => {
        const { top, left } = collection.window;
        // Get information about available displays
        const displayInfo = await browser.system.display.getInfo();
        // Iterate through displays
        for (let display of displayInfo) {
            const displayBounds = display.bounds;

            // Check if the coordinates are within this display's bounds
            if (
                top >= displayBounds.top &&
                top <= displayBounds.top + displayBounds.height &&
                left >= displayBounds.left &&
                left <= displayBounds.left + displayBounds.width
            ) {
                return true; // Found a display that contains the coordinates
            }
        }
        return false; // Coordinates are not within any display bounds
        
    };


    const _handleUpdate = async () => {
        const { tabsArray: previousCollections } = await browser.storage.local.get('tabsArray');
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { chkManualUpdateLinkCollection } = await browser.storage.local.get('chkManualUpdateLinkCollection');
        if (chkEnableAutoUpdate && chkManualUpdateLinkCollection) {
            let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack') || [];
            const activeWindowId = collectionsToTrack.find(c => c.collectionUid === props.collection.uid)?.windowId;
            if (!activeWindowId) {
                const trackObj = {
                    collectionUid: props.collection.uid,
                    windowId: (await browser.windows.get(browser.windows.WINDOW_ID_CURRENT)).id
                }
                collectionsToTrack.push(trackObj);
                await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
                setIsAutoUpdate(true);
            }
        }
        let newItem = await getCurrentTabsAndGroups(props.collection.name);
        newItem.color = props.collection.color;
        newItem.uid = props.collection.uid;
        await props.updateCollection(newItem);
        setRowToHighlight(props.index);
        playHighlight(true);
        setTimeout(() => setRowToHighlight(-1), 1000);
        openUpdateSnackbar(
            <SnackBarWithUndo
                icon={<FaRegCheckCircle />}
                message={`Collection updated ${chkEnableAutoUpdate && chkManualUpdateLinkCollection ? 'and linked to window' : ''} successfully`}
                collectionName={props.collection.name}
                updateRemoteData={props.updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeUpdateSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
    };

    const _handleOpenTabs = async () => {
        if (isExpanded) return;
        if (isAutoUpdate) {
            await _handleFocusWindow();
            return;
        }
        const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
        let window;
        if (chkOpenNewWindow) {
            const hasWindowProp = 'window' in props.collection && props.collection.window;
            const isCollectionWithinBounds = hasWindowProp && await isWithinDisplayBounds(props.collection);
            let windowCreationObject = {
                focused: true,
                width: hasWindowProp ? props.collection.window.width : null,
                height: hasWindowProp ? props.collection.window.height : null
            }
            if (isCollectionWithinBounds) {
                windowCreationObject.left = props.collection.window.left;
                windowCreationObject.top = props.collection.window.top;
            }
            window = await browser.windows.create(windowCreationObject);
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
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        setIsAutoUpdate(false);
        if (!collectionsToTrack || collectionsToTrack == {}) return;
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(props.collection.uid);
        if (!collectionIsActive) return;
        const newCollectionsToTrack = collectionsToTrack.filter(c => c.collectionUid !== props.collection.uid);
        await browser.storage.local.set({ collectionsToTrack: newCollectionsToTrack });
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
        props.updateCollection(currentCollection);
        openSnackbar(`Collection name updated to '${val}'!`, 5000);
    }

    const totalGroups = props.collection.chromeGroups ? props.collection.chromeGroups.length : 0;
    let style = props.highlightRow ? highlightStyle : {};
    style = isDeleted ? deleteStyle : style;

    return (
        <div className={`row setting_row ${isAutoUpdate && 'active-auto-tracking'}`} style={{ ...style, borderLeft: `5px solid ${isExpanded ? 'transparent' : props.collection.color}`, backgroundColor: isExpanded ? 'var(--setting-row-hover-bg-color)' : null }}>
            <div
                className="column handle"
                {...props.dragHandleProps.attributes}
                {...props.dragHandleProps.listeners}
            >
                <MdDragIndicator />
            </div>
            <div className="column" style={{ flex: '0 0 20px' }}>
                <div style={{ position: 'relative', display: 'flex' }}>
                    <ColorPicker
                        currentColor={props.collection.color}
                        tooltip="Choose a color for this collection"
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
                    data-tip={`${isAutoUpdate ? 'Stop auto updating' : 'Update'} this collection`}
                    className={`float-button ${isAutoUpdate ? 'stop_btn' : 'update_btn'}`}
                    onClick={async () => isAutoUpdate ? _handleStopTracking() : await _handleUpdate()}
                >
                    {isAutoUpdate ? <FaStop /> : 'update'}
                </span>
                <span data-tip={'Export Collection to File'} onClick={() => _exportCollectionToFile()} className="export">
                    <FaCloudDownloadAlt color="var(--primary-color)" size="18" />
                </span>
                <span data-tip={'Delete Collection'} className="export" onClick={async () => await _handleDelete()}>
                    <MdDeleteForever color="#e74c3c" size="18" />
                </span>
                <span
                    className={`expand-icon ${isExpanded ? 'expan-open' : ''}`}
                    data-tip={`${isExpanded ? 'Collapse' : 'Expand'} list of tabs`}
                    onClick={(e) => {
                        e.stopPropagation();
                        _handleExpand();
                    }}
                >
                    ⌃
                </span>
            </div>
            {isExpanded ? <ExpandedCollectionData
                collection={props.collection}
                updateCollection={props.updateCollection}
                updateRemoteData={props.updateRemoteData} /> : null}
        </div>);
}

export default CollectionListItem;