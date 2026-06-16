// chrome/duplicate-detect.js
// PURE duplicate detection: URL normalization + grouping. No AI, no storage.
// Loaded in the SW via importScripts; loaded in tests via require().
(() => {
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src',
]);

// Deterministic key for a URL so trivial variants collapse to one. On any parse
// failure (chrome://, file://, malformed) we fall back to the raw trimmed string
// so detection never throws and exact matches still collapse.
function normalizeUrlForDedup(rawUrl) {
    const trimmed = String(rawUrl == null ? '' : rawUrl).trim();
    let u;
    try { u = new URL(trimmed); } catch { return trimmed; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return trimmed;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const params = [];
    for (const [k, v] of u.searchParams.entries()) {
        if (!TRACKING_PARAMS.has(k.toLowerCase())) params.push([k, v]);
    }
    // Sort by key then value (stable, total order — returns 0 on equality) so
    // param order never affects the key.
    params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    // Re-serialize via URLSearchParams so values containing '&', '=', spaces, or
    // '+' are encoded correctly and can't corrupt the key.
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    // Scheme intentionally omitted from the key so http/https collapse together.
    return `${host}${path}${query}`;
}

// collections: [{ uid, name, tabs: [{ uid, url, title }] }]
// Returns { groups: [...] }.
// Group shape:
//   { id, kind: 'cross'|'within', collectionUids: [], urls: [ { normalizedUrl, occurrences: [ { collectionUid, tabUid, title, url, position } ] } ], status: 'pending', recommendation: null }
//   position = zero-based index of the tab within its collection.
function detectDuplicateGroups(collections) {
    const byUrl = new Map(); // normalizedUrl -> [{ collectionUid, tabUid, title, url, position }]
    for (const c of collections || []) {
        const tabs = Array.isArray(c.tabs) ? c.tabs : [];
        tabs.forEach((t, position) => {
            if (!t || !t.url) return;
            const key = normalizeUrlForDedup(t.url);
            if (!byUrl.has(key)) byUrl.set(key, []);
            byUrl.get(key).push({ collectionUid: c.uid, tabUid: t.uid, title: t.title || '', url: t.url, position, tab: { ...t } });
        });
    }

    const crossBySet = new Map(); // setKey -> { collectionUids, urls: [] }
    const withinByCol = new Map(); // collectionUid -> { urls: [] }

    for (const [normalizedUrl, occ] of byUrl.entries()) {
        if (occ.length < 2) continue;
        const distinct = [...new Set(occ.map((o) => o.collectionUid))];
        if (distinct.length >= 2) {
            const setKey = [...distinct].sort().join('|');
            if (!crossBySet.has(setKey)) crossBySet.set(setKey, { collectionUids: [...distinct].sort(), urls: [] });
            crossBySet.get(setKey).urls.push({ normalizedUrl, occurrences: occ });
        } else {
            const col = distinct[0];
            if (!withinByCol.has(col)) withinByCol.set(col, { urls: [] });
            withinByCol.get(col).urls.push({ normalizedUrl, occurrences: occ });
        }
    }

    const groups = [];
    for (const [setKey, g] of crossBySet.entries()) {
        groups.push({ id: `cross:${setKey}`, kind: 'cross', collectionUids: g.collectionUids, urls: g.urls, status: 'pending', recommendation: null });
    }
    for (const [col, g] of withinByCol.entries()) {
        groups.push({ id: `within:${col}`, kind: 'within', collectionUids: [col], urls: g.urls, status: 'pending', recommendation: null });
    }
    return { groups };
}

const taboxDuplicateDetectApi = { normalizeUrlForDedup, detectDuplicateGroups };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxDuplicateDetect = taboxDuplicateDetectApi;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = taboxDuplicateDetectApi;
})();
