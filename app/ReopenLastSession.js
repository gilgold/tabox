import { React, useState, useEffect } from 'react';
import './ReopenLastSession.css';
import { browser } from '../static/index';

export default function ReopenLastSession(props) {

    const [lastClosedTab, setLastClosedTab] = useState();
    const [lastClosedWindow, setLastClosedWindow] = useState();
  
    useEffect(async () => {
      const filter = {maxResults:10};
      const sessions = await browser.sessions.getRecentlyClosed(filter);
      const windows = sessions.filter(({ window }) => window !== undefined);
      const tabs = sessions.filter(({ tab }) => tab !== undefined);
      const mostRecentWindow = (windows && windows.length > 0) ? windows[0].window.sessionId : false;
      const mostRecentTab = (tabs && tabs.length > 0) ? tabs[0].tab.sessionId : false;
      setLastClosedWindow(mostRecentWindow);
      setLastClosedTab(mostRecentTab);
    }, []);
  
    const handleOpenTab = () => {
      browser.sessions.restore(lastClosedTab);
    };
    const handleOpenWindow = () => {
      browser.sessions.restore(lastClosedWindow);
    };
  
    return lastClosedTab || lastClosedWindow ? <div id='rowClosed'>
      <div className='session_div'>
        Reopen your last closed 
        { lastClosedTab ? <button onClick={handleOpenTab} title='Reopen your recently closed tab'>tab</button> : '' }
        { lastClosedTab && lastClosedWindow ? 'or' : '' }
        { lastClosedWindow ? <button onClick={handleOpenWindow} title='Reopen your recently closed window'>window</button> : ''}
      </div>
    </div> : '';
  }