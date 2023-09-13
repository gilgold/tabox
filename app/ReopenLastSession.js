import { React, useEffect, useState } from 'react';
import './ReopenLastSession.css';
import { browser } from '../static/globals';
import { confirmAlert } from 'react-confirm-alert';
import { SessionsModal } from './SessionsModal';

const ReopenLastSession = ({ addCollection }) => {

  const [sessionList, setSessionList] = useState([]);

  useEffect(async () => {
    let { sessions } = await browser.storage.local.get('sessions');
    sessions = sessions || [];
    setSessionList(sessions);
  }, [sessionList])

  const handleSessionClick = async () => {
    confirmAlert({
      customUI: ({ onClose }) => <SessionsModal
        sessions={sessionList}
        addCollection={addCollection}
        onClose={onClose} />
    });
  }

  return <div id='rowClosed'>
    <div className='session_div'>
      <button disabled={sessionList.length === 0} onClick={async () => await handleSessionClick()}>Restore Session</button>
    </div>
  </div>;
}

export default ReopenLastSession;