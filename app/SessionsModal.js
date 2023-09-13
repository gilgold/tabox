import React from 'react';
import './BackupOptionsModal.css';
import './SessionsModal.css';
import { CgBrowser } from 'react-icons/cg';
import { SlClose } from 'react-icons/sl';
import TimeAgo from 'javascript-time-ago';
import { browser } from '../static/globals';

const buildCollectionTitle = (tabs, chromeGroups) => {
    const totalGroups = chromeGroups.length;
    return `${tabs.length} tab${tabs.length > 1 ? 's' : ''} ${totalGroups > 0 ? `(${totalGroups} group${totalGroups > 1 ? 's' : ''})` : '' }`;
}

export const SessionsModal = ({ sessions, onClose, addCollection }) => {

    const timeAgo = new TimeAgo('en-US');

    const handleRestore = async (collection) => {
        const window = await browser.windows.create({ focused: true });
        const msg = {
            type: 'openTabs',
            collection: collection,
            window: window
        };
        await browser.runtime.sendMessage(msg);
    }

    const handleSaveCollection = async (collection) => {
        await addCollection(collection);
    }

    return (
        <div className='modal-card'>
            <div className='modal-card-wrapper session-card-wrapper'>
                <div className='close-button'><SlClose size={'25px'} onClick={onClose} /></div>
                <div className='modal-card-content'>
                    <div className='modal-card-header'>
                        Session Restore
                    </div>
                    <div className='modal-card-body'>
                        <div className='modal-card-body-section'>
                            Tabox auto saves your open windwos into sessions.<br />
                            Here you can select a window to restore.
                        </div>
                        <div className='modal-card-body-section'>
                            <div className='session-list-wrapper'>
                                {sessions && sessions.map((session, index) => <div className='session-wrapper' key={`session ${index}`}>
                                    <div className='session-name'>
                                        <div className='session-title'>
                                        { `${session.collections.length} window${session.collections.length > 1 ? 's' : ''}` }
                                        </div>
                                        <div className='session-date'>
                                            { index === 0 ? 'current session' : timeAgo.format(new Date(session.timestamp)) }
                                        </div>
                                    </div>
                                    {session.collections.map((collection) => <div className='collection-row' key={collection.uid}>
                                        <div className='collection-corner'><CgBrowser size={'20px'} /></div>
                                        <div className='collection-text'>
                                            { buildCollectionTitle(collection.tabs, collection.chromeGroups) }
                                        </div>
                                        <div className='collection-actions'>
                                            <button className='btn collection-action' onClick={async () => await handleRestore(collection)}><span>Restore Window</span></button>
                                            <button className='btn collection-action add-collection' onClick={async () => await handleSaveCollection(collection)}><span>Save</span></button>
                                        </div>
                                    </div>)}
                                </div>)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}