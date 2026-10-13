import React, { useEffect, useState } from 'react';
import { browser } from '../static/globals';
import { isSingleWindowBrowser } from './utils/platform';
import './SingleWindowTabsNote.css';

// Firefox for Android only exposes tabs that are loaded in memory: a tab
// restored after a restart stays invisible to extensions until the user
// visits it (Mozilla bug 1583281). Say how many tabs will be saved and how
// to include missing ones, so a short collection isn't a silent surprise.
function SingleWindowTabsNote() {
    const [count, setCount] = useState(null);

    useEffect(() => {
        if (!isSingleWindowBrowser()) return;
        let active = true;
        const extensionOrigin = browser.runtime.getURL('');
        browser.tabs.query({})
            .then((tabs) => {
                if (!active) return;
                setCount(tabs.filter(t => t.url && !t.url.startsWith(extensionOrigin) && !t.url.startsWith('about:')).length);
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (!isSingleWindowBrowser() || count === null) return null;
    return (
        <p className="single-window-tabs-note" data-testid="single-window-tabs-note">
            Saving <strong>{count} open {count === 1 ? 'tab' : 'tabs'}</strong>. Firefox for Android only shares
            tabs you&apos;ve opened since it started &mdash; switch to a missing tab once, then save again.
        </p>
    );
}

export default SingleWindowTabsNote;
