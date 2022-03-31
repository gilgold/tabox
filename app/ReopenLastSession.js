import { React, useState, useEffect } from 'react';
import './ReopenLastSession.css';
import { browser } from '../static/globals';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';

export default function ReopenLastSession() {

    const [lastClosedTab, setLastClosedTab] = useState();
    const [lastClosedWindow, setLastClosedWindow] = useState();
    const [openSnackbar, ] = useSnackbar({ style: SnackbarStyle.ERROR });
  
    useEffect(async () => {
      const filter = { maxResults:10 };
      const sessions = await browser.sessions.getRecentlyClosed(filter);
      const windows = sessions.filter(({ window }) => window !== undefined);
      const tabs = sessions.filter(({ tab }) => tab !== undefined);
      const mostRecentWindow = (windows && windows.length > 0) ? windows[0].window.sessionId : false;
      const mostRecentTab = (tabs && tabs.length > 0) ? tabs[0].tab.sessionId : false;
      setLastClosedWindow(mostRecentWindow);
      setLastClosedTab(mostRecentTab);
    }, []);
  
    const handleSessionRestore = async (session) => {
      try {
        await browser.sessions.restore(session);
      } catch (e) {
        openSnackbar('Invalid session ID - please reopen Tabox and try again', 4000);
        return;
      }
    };
  
    return lastClosedTab || lastClosedWindow ? <div id='rowClosed'>
      <div className='session_div'>
        Reopen your last closed 
        { lastClosedTab ? <button onClick={async () => await handleSessionRestore(lastClosedTab)} title='Reopen your recently closed tab'>tab</button> : '' }
        { lastClosedTab && lastClosedWindow ? 'or' : '' }
        { lastClosedWindow ? <button onClick={async () => await handleSessionRestore(lastClosedWindow)} title='Reopen your recently closed window'>window</button> : ''}
      </div>
    </div> : '';
  }