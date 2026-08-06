import React, { Activity } from 'react';
import './Modal.css';
import { CgBrowser } from 'react-icons/cg';
import { SlClose } from 'react-icons/sl';
import TimeAgo from 'javascript-time-ago';
import { buildCollectionFromSnapshot } from './utils/saveCollectionSnapshot';
import { restoreBrowserSession } from './utils/browserSessions';
import { countNonEmptyGroups } from './utils/groupCount';

const buildCollectionTitle = (tabs = [], chromeGroups = []) => {
    const totalGroups = countNonEmptyGroups({ tabs, chromeGroups });
    return `${tabs.length} tab${tabs.length > 1 ? 's' : ''} ${totalGroups > 0 ? `(${totalGroups} group${totalGroups > 1 ? 's' : ''})` : '' }`;
};

export const SessionsModal = ({ isOpen, sessions, onClose, addCollection }) => {

    const timeAgo = new TimeAgo('en-US');

    const handleRestore = async (collection) => {
        await restoreBrowserSession(collection);
    };

    const handleSaveCollection = async (collection) => {
        const newCollection = buildCollectionFromSnapshot({
            snapshot: collection,
            name: collection.name || buildCollectionTitle(collection.tabs || [], collection.chromeGroups || []),
        });
        await addCollection(newCollection);
    };

    return (
        <Activity mode={isOpen ? 'visible' : 'hidden'}>
            <div className='modal-card'>
            <div className='modal-card-wrapper session-card-wrapper'>
                <div className='modal-close-button'><SlClose size={'25px'} onClick={onClose} /></div>
                <div className='modal-card-content'>
                    <div className='modal-card-header'>
                        Recently Closed
                    </div>
                    <div className='modal-card-body'>
                        <div className='modal-card-body-section'>
                            Recently closed tabs and windows from your browser appear here.<br />
                            Select an item to restore or save it as a collection.
                        </div>
                        <div className='modal-card-body-section'>
                            <div className='session-list-wrapper'>
                                {sessions && sessions.map((session, index) => <div className='session-wrapper' key={`session ${index}`}>
                                    <div className='session-name'>
                                        <div className='session-title'>
                                        { `${session.collections.length} item${session.collections.length > 1 ? 's' : ''}` }
                                        </div>
                                        <div className='session-date'>
                                            { timeAgo.format(new Date(session.timestamp)) }
                                        </div>
                                    </div>
                                    {session.collections.map((collection) => <div className='collection-row' key={collection.uid}>
                                        <div className='collection-corner'><CgBrowser size={'20px'} /></div>
                                        <div className='collection-text'>
                                            { buildCollectionTitle(collection.tabs, collection.chromeGroups) }
                                        </div>
                                        <div className='collection-actions'>
                                            <button className='btn collection-action' onClick={async () => await handleRestore(collection)}><span>Restore</span></button>
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
        </Activity>
    );
}
