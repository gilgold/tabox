import React from 'react';
import { browser } from '../static/globals';
import { AiFillPushpin } from 'react-icons/ai';
import { FaVolumeMute } from 'react-icons/fa';
import { MdDeleteForever, MdOutlineOpenInNew } from 'react-icons/md';
import { getColorCode } from './utils';


function TabRow({ tab, updateCollection, collection, group = null }) {
    const fallbackFavicon = './images/favicon-fallback.png';

    const handleTabDelete = () => {
        let currentCollection = { ...collection };
        let newTabList = [...currentCollection.tabs].filter(t => t.uid !== tab.uid)
        let newChromeGroups = [...currentCollection.chromeGroups];
        if (tab.groupUid) {
            const totalTabsInGroup = newTabList.filter(el => el.groupUid === tab.groupUid).length;
            if (totalTabsInGroup === 0) {
                newChromeGroups = newChromeGroups.filter(cg => cg.uid !== tab.groupUid)
            }
        }
        currentCollection.tabs = newTabList;
        currentCollection.chromeGroups = newChromeGroups;
        updateCollection(currentCollection);
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

    return (
        <div className='tab-line' id={`tab-line-${tab.uid}`} key={`tab-line-${tab.uid}`}>
            <div className="row single-tab-row" key={`line-${tab.uid}`}>
                <div className="tree-line"></div>
                {(tab.groupId > -1) ?
                    <div
                        className="group-indicator"
                        style={{
                            backgroundColor: group ? getColorCode(group.color) : 'transparent',
                            boxShadow: group ? `${getColorCode(group.color)} -3px 1px 3px -2px` : 'none'
                        }} /> :
                    <div className="group-placeholder" />}
                {tab.pinned ? <div className="tab-property pinned-tab" title="Pinned Tab">
                    <AiFillPushpin size="12px" color="#FFF" />
                </div> : null}
                {tab.mutedInfo?.muted ? <div className="tab-property muted-tab" title="Muted Tab">
                    <FaVolumeMute color="#fff" size="14px" />
                </div> : null}
                <div className="column favicon-col">
                    <img onError={handleFaviconError} className="tab-favicon" src={tab.favIconUrl ? tab.favIconUrl : /\.(jpg|jpeg|gif|png|ico|tiff)$/.test(tab?.url?.split('?')[0]) ? tab.url : fallbackFavicon} />
                </div>
                <div className="column single-tab-title-col">
                    <span className="single-tab-title" title={tab.title}>{tab.title}</span>
                </div>
                <div className="column actions-col">
                    <button className="action-button" data-tip="Open this tab" onClick={async () => await handleOpenTab(tab)}>
                        <MdOutlineOpenInNew size="16px" color="var(--primary-color)" />
                    </button>
                    <button className="action-button del-tab" data-tip="Delete this tab" onClick={() => handleTabDelete()}>
                        <MdDeleteForever color="#B64A4A" size="20" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default TabRow;