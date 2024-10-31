import React, { useEffect, useState } from 'react';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { getCurrentTabsAndGroups } from './utils';
import { browser } from '../static/globals';
import TabRow from './TabRow';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import ColorPicker from './ColorPicker';
import DeleteWithConfirmationButton from './DeleteWithConfirmationButton';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { AiOutlineFolderAdd } from 'react-icons/ai';
import { getColorCode, getColorName, colorChart } from './utils';
import { UNDO_TIME } from './constants';


function ExpandedCollectionData(props) {
    const [openSnackbar, closeSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: { display: 'none' } });
    const [isHighlighted, setIsHighlighted] = useState(false);

    useEffect(async () => {
        setIsHighlighted((await browser.tabs.query({ highlighted: true })).length > 1);
    }, [])

    let previousGroupUid = null;

    const groupFromId = (_id, groups = props.collection.chromeGroups) => {
        return groups.find(el => el.uid === _id);
    }

    const _updateGroupAttribute = (group, attr, val) => {
        let currentCollection = { ...props.collection };
        const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === group.uid);
        let chromeGroups = [...currentCollection.chromeGroups];
        let chromeGrp = { ...chromeGroups[grpIndex] }
        chromeGrp[attr] = val;
        chromeGroups[grpIndex] = chromeGrp;
        currentCollection.chromeGroups = chromeGroups;
        props.updateCollection(currentCollection);
    }

    const handleSaveGroupColor = async (color, group) => _updateGroupAttribute(group, 'color', getColorName(color));
    const saveGroupName = (title, group) => _updateGroupAttribute(group, 'title', title);

    const _handleDeleteGroup = (groupUid) => {
        let currentCollection = { ...props.collection };
        currentCollection.tabs = [...currentCollection.tabs].filter(el => el.groupUid !== groupUid);
        currentCollection.chromeGroups = [...currentCollection.chromeGroups].filter(cg => cg.uid !== groupUid);
        props.updateCollection(currentCollection);
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
        props.updateCollection(currentCollection);
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
        {props.collection.tabs.map(tab => [
            GroupHeader(tab.groupUid),
            <TabRow
                key={`tab-row-${tab.uid}`}
                tab={tab}
                updateCollection={props.updateCollection}
                collection={props.collection}
                group={groupFromId(tab.groupUid)} />
        ])}
    </div>
}

export default ExpandedCollectionData;