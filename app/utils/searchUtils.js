import React from 'react';

export function escapeRegex(string) {
    return string.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function highlightText(text, search, matchClassName) {
    if (!text || !search?.trim()) return null;
    const searchTerm = search.trim();
    const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
    if (!text.match(searchRegex)) return null;
    const parts = text.split(new RegExp(`(${escapeRegex(searchTerm)})`, 'gi'));
    return parts.map((part, i) =>
        part.toLowerCase() === searchTerm.toLowerCase()
            ? <span key={i} className={matchClassName}>{part}</span>
            : part || null
    ).filter(Boolean);
}

export function getMatchingTabs(collection, search) {
    if (!search || !search.trim()) return [];
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    return (collection.tabs || []).filter(tab =>
        tab.title?.match(searchRegex) || tab.url?.match(searchRegex)
    );
}

export function getMatchingSessionWindows(sessionList, search) {
    if (!search || !search.trim()) return [];

    return (sessionList || []).flatMap((session) => (
        (session.collections || []).map((collection) => {
            const matchingTabs = getMatchingTabs(collection, search);

            return {
                sessionTimestamp: session.timestamp,
                collection,
                matchingTabs,
            };
        }).filter((entry) => entry.matchingTabs.length > 0)
    ));
}
