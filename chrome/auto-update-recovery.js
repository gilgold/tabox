// Machine-local restart recovery. No collection writes, sync data, or timers.
(() => {
    const KEY = 'autoUpdateRecovery';
    const SESSION_KEY = 'autoUpdateRecoverySession';
    const ALARM = 'auto-update-recovery';
    const PERIOD = 180000;
    const EARLIEST = 120000;
    const STABLE = 60000;
    const RETENTION = 7 * 86400000;
    const CLOSED_RETENTION = 86400000;

    // Compare ordered tabs including duplicates, pinning, privacy and the group
    // partition. Group IDs are session-local; first appearance assigns an ordinal.
    function signature(tabs, groups, incognito, normalize, live = false) {
        if (!Array.isArray(tabs) || !tabs.length || !Array.isArray(groups)) return null;
        const groupOrder = [];
        const result = [];
        for (const tab of tabs) {
            if (!tab || (live && (tab.status === 'loading' || (tab.status !== 'complete' && !tab.discarded)))) return null;
            const normalized = normalize(tab);
            const url = normalized.url;
            // Only stable web destinations. Deferred wrappers use the shared
            // issue 121 normalizer, including pendingUrl; other pending loads wait.
            if (tab.pendingUrl && tab.pendingUrl !== tab.url && normalized.url === tab.url) return null;
            try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return null; }
            catch { return null; }
            let group = null;
            if (tab.groupUid || (tab.groupId != null && tab.groupId !== -1)) {
                const definition = groups.find(g => g && (tab.groupUid && g.uid ? g.uid === tab.groupUid : g.id === tab.groupId));
                if (!definition) return null;
                if (!groupOrder.includes(definition)) groupOrder.push(definition);
                group = [groupOrder.indexOf(definition), definition.title || '', definition.color || '', !!definition.collapsed];
            }
            result.push([url, !!tab.pinned, !!(tab.incognito || tab.wasIncognito || incognito), group]);
        }
        return JSON.stringify([!!incognito, result]);
    }

    function createRecovery({ browser, normalize, loadCollection, loadCollections, loadFolder, now = Date.now }) {
        let chain = Promise.resolve();
        let revision = 0;
        let updateRevision = 0;
        const stopRevisions = new Map();
        const run = task => {
            const result = chain.then(task);
            chain = result.catch(() => {});
            return result;
        };
        const supported = () => !!(browser.windows?.getAll && browser.storage.session?.get && browser.storage.session?.set && browser.alarms?.create && browser.alarms?.clear);
        const enabled = data => data.chkResumeAutoUpdate === true && data.chkEnableAutoUpdate === true && supported();
        const read = () => browser.storage.local.get(['chkResumeAutoUpdate', 'chkEnableAutoUpdate', 'collectionsToTrack', KEY]);
        const validEntry = e => e && typeof e.collectionUid === 'string' && e.collectionUid.length > 0 &&
            typeof e.signature === 'string' && Number.isFinite(e.savedAt) && e.savedAt <= now() && now() - e.savedAt <= RETENTION &&
            (e.closedAt === undefined || (Number.isFinite(e.closedAt) && e.closedAt <= now() && now() - e.closedAt <= CLOSED_RETENTION));
        const stateOf = data => data[KEY]?.version === 1 && Array.isArray(data[KEY].entries)
            ? { ...data[KEY], entries: data[KEY].entries.filter(validEntry) } : { version: 1, entries: [] };
        const sourceSignature = c => c && signature(c.tabs, c.chromeGroups || [], !!(c.savedFromIncognito || c.window?.incognito), normalize);
        async function writable(c) {
            return c && (!c.parentId || (await loadFolder(c.parentId))?.shared?.role !== 'read');
        }
        async function windowsNow() {
            const windows = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
            const result = [];
            for (const w of windows) {
                const groups = browser.tabGroups?.query ? await browser.tabGroups.query({ windowId: w.id }) : [];
                result.push({ id: w.id, signature: signature(w.tabs, groups, !!w.incognito, normalize, true) });
            }
            return result.sort((a, b) => a.id - b.id);
        }
        // Lifecycle events establish samples too: the first alarm may arrive
        // more than a minute after startup. A later event always restarts the
        // full stability interval, even when the signature did not change.
        async function sample(pending) {
            pending.observation = null;
            pending.since = now();
            if (now() >= pending.deadline) return;
            const observedRevision = revision;
            try {
                const windows = await windowsNow();
                if (revision === observedRevision && now() < pending.deadline) {
                    pending.observation = JSON.stringify(windows);
                    pending.since = now();
                }
            } catch { /* An incomplete read never establishes stability. */ }
        }
        async function ensure(startup = false) {
            let data = await read();
            if (!enabled(data)) {
                // Resume OFF keeps the pre-recovery startup behavior. Only an
                // opted-in (but unsupported/disabled) recovery quarantines IDs.
                if (data[KEY]?.entries?.length || data[KEY]?.pending || startup) {
                    await browser.storage.local.set({ [KEY]: { version: 1, entries: [] }, ...(startup && data.chkResumeAutoUpdate === true ? { collectionsToTrack: [] } : {}) });
                }
                if (supported() && (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY] !== 1) {
                    await browser.storage.session.set({ [SESSION_KEY]: 1 });
                }
                return data;
            }
            const session = (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY];
            if (session !== 1) {
                const entries = stateOf(data).entries;
                const startedAt = now();
                const state = { version: 1, entries, pending: { startedAt, deadline: startedAt + PERIOD, candidates: entries.map(e => e.collectionUid) } };
                // Quarantine stale IDs before any asynchronous browser read.
                await browser.storage.local.set({ collectionsToTrack: [], [KEY]: state });
                // Alarms are a wake-up mechanism, never evidence that restore is complete.
                await browser.alarms.create(ALARM, { periodInMinutes: 1 });
                await browser.storage.session.set({ [SESSION_KEY]: 1 });
                await sample(state.pending);
                await browser.storage.local.set({ [KEY]: state });
                data = await read();
            }
            return data;
        }
        async function remember(uid, windowId) {
            const data = await read();
            if (!enabled(data)) return;
            const state = stateOf(data);
            state.entries = state.entries.filter(e => e.collectionUid !== uid);
            try {
                const c = await loadCollection(uid);
                const sig = sourceSignature(c);
                const w = (await windowsNow()).find(w => w.id === windowId);
                if (sig && w?.signature === sig && await writable(c)) state.entries.push({ collectionUid: uid, signature: sig, savedAt: now() });
            } catch { /* Failed/incomplete snapshot reads revoke stale eligibility. */ }
            await browser.storage.local.set({ [KEY]: state });
        }
        const track = (uid, windowId) => run(async () => {
            if (!browser.windows) return;
            await ensure();
            const data = await read();
            const tracking = (data.collectionsToTrack || []).filter(c => c.collectionUid !== uid && c.windowId !== windowId);
            tracking.push({ collectionUid: uid, windowId });
            const displaced = (data.collectionsToTrack || []).filter(c => c.windowId === windowId && c.collectionUid !== uid).map(c => c.collectionUid);
            const state = stateOf(data);
            state.entries = state.entries.filter(e => !displaced.includes(e.collectionUid));
            if (state.pending) state.pending.candidates = state.pending.candidates?.filter(id => id !== uid && !displaced.includes(id)) || [];
            await browser.storage.local.set({ collectionsToTrack: tracking, [KEY]: state });
            await remember(uid, windowId);
        });
        const close = windowId => run(async () => {
            await ensure();
            const data = await read();
            const closed = (data.collectionsToTrack || []).filter(c => c.windowId === windowId).map(c => c.collectionUid);
            const state = stateOf(data);
            state.entries = state.entries.map(e => closed.includes(e.collectionUid) ? { ...e, closedAt: now() } : e);
            if (state.pending) await sample(state.pending);
            await browser.storage.local.set({ collectionsToTrack: (data.collectionsToTrack || []).filter(c => c.windowId !== windowId), [KEY]: state });
            // Keep the last complete snapshot: onRemoved cannot distinguish exit
            // from a regular close. It is eligible only during the NEXT startup.
        });
        const stop = uids => {
            const targets = new Set([].concat(uids));
            // A queued stop must veto a collection write already awaiting tab data.
            for (const uid of targets) stopRevisions.set(uid, (stopRevisions.get(uid) || 0) + 1);
            return run(async () => {
                await ensure();
                const data = await read();
                const state = stateOf(data);
                const removed = new Set([...state.entries, ...(data.collectionsToTrack || [])]
                    .filter(e => targets.has(e.collectionUid)).map(e => e.collectionUid));
                state.entries = state.entries.filter(e => !targets.has(e.collectionUid));
                await browser.storage.local.set({
                    collectionsToTrack: (data.collectionsToTrack || []).filter(c => !targets.has(c.collectionUid)), [KEY]: state,
                });
                return removed.size;
            });
        };
        const prune = () => run(async () => {
            await ensure();
            if (!browser.windows) return;
            const data = await read();
            const ids = new Set((await browser.windows.getAll({ populate: false })).map(w => w.id));
            await browser.storage.local.set({ collectionsToTrack: (data.collectionsToTrack || []).filter(t => ids.has(t.windowId)) });
        });
        const tick = () => run(async () => {
            const observedRevision = revision;
            const data = await ensure();
            if (!enabled(data)) return;
            const state = stateOf(data);
            if (!state.pending) return;
            const pending = state.pending;
            if (!Number.isFinite(pending.startedAt) || !Number.isFinite(pending.deadline) ||
                pending.deadline !== pending.startedAt + PERIOD || pending.startedAt > now() ||
                !Array.isArray(pending.candidates) || pending.candidates.some(uid => typeof uid !== 'string')) {
                await browser.storage.local.set({ [KEY]: { version: 1, entries: [] }, collectionsToTrack: [] });
                await browser.alarms.clear(ALARM);
                return;
            }
            const expired = now() >= pending.deadline;
            let windows;
            try { windows = expired ? [] : await windowsNow(); }
            catch {
                if (now() < pending.deadline) return;
                windows = []; // Retire the bounded attempt; never match a failed read.
            }
            const observation = JSON.stringify(windows);
            if (pending.observation !== observation) {
                pending.observation = observation;
                pending.since = now();
            }
            const stable = Number.isFinite(pending.since) && now() - pending.since >= STABLE;
            if (!expired && (now() - pending.startedAt < EARLIEST || !stable)) {
                await browser.storage.local.set({ [KEY]: state });
                return;
            }
            const tracking = data.collectionsToTrack || [];
            // Preserve the two-minute restore quarantine and a whole minute of
            // identical observations. The third minute is bounded scheduling
            // slack, never permission to adopt a window after the cutoff.
            if (!expired && stable && windows.every(w => w.signature)) {
                const collections = await loadCollections();
                for (const entry of state.entries.filter(e => pending.candidates.includes(e.collectionUid))) {
                    const c = collections.find(c => c.uid === entry.collectionUid);
                    const matches = windows.filter(w => w.signature === entry.signature);
                    if (sourceSignature(c) !== entry.signature || !await writable(c) || matches.length !== 1 ||
                        state.entries.filter(e => e.signature === entry.signature).length !== 1 ||
                        state.entries.filter(e => e.collectionUid === entry.collectionUid).length !== 1 ||
                        collections.filter(c => sourceSignature(c) === entry.signature).length !== 1 ||
                        tracking.some(t => t.collectionUid === entry.collectionUid || t.windowId === matches[0].id)) continue;
                    tracking.push({ collectionUid: entry.collectionUid, windowId: matches[0].id });
                }
            }
            const latest = await read();
            if (revision !== observedRevision || !enabled(latest) || (!expired && now() >= pending.deadline)) return;
            delete state.pending;
            // Prior-session candidates get one attempt. Fresh manual associations
            // (including regular closes) remain eligible only for a later restart.
            state.entries = state.entries.filter(e => !pending.candidates.includes(e.collectionUid) ||
                tracking.some(t => t.collectionUid === e.collectionUid)).map(e => {
                if (!tracking.some(t => t.collectionUid === e.collectionUid)) return e;
                const { closedAt, ...active } = e; // eslint-disable-line no-unused-vars
                return { ...active, savedAt: now() };
            });
            await browser.storage.local.set({ collectionsToTrack: tracking, [KEY]: state });
            await browser.alarms.clear(ALARM);
        });
        const activity = () => {
            revision++;
            return run(async () => {
                const data = await ensure();
                const state = stateOf(data);
                if (!enabled(data) || !state.pending) return;
                await sample(state.pending);
                await browser.storage.local.set({ [KEY]: state });
            });
        };
        // Queue cleanup without returning that queued promise to storage.set:
        // writes in this queue themselves emit onChanged (including test harnesses
        // that await listeners). Synchronous revision changes veto in-flight reads.
        function storageChanged(changes, area) {
            if (area !== 'local') return;
            if (changes.chkEnableAutoUpdate && changes.chkEnableAutoUpdate.newValue !== true) updateRevision++;
            const disabled = ['chkResumeAutoUpdate', 'chkEnableAutoUpdate'].some(k =>
                changes[k] && changes[k].newValue !== true);
            const deleted = Object.keys(changes).filter(k => k.startsWith('collection_') && !changes[k].newValue)
                .map(k => k.slice('collection_'.length));
            if (disabled || Object.keys(changes).some(k => k.startsWith('collection_') || k.startsWith('folder_'))) revision++;
            if (!disabled && !deleted.length) return;
            run(async () => {
                const data = await read();
                const state = stateOf(data);
                state.entries = disabled ? [] : state.entries.filter(e => !deleted.includes(e.collectionUid));
                if (disabled) delete state.pending;
                await browser.storage.local.set({ [KEY]: state,
                    ...(deleted.length ? { collectionsToTrack: (data.collectionsToTrack || []).filter(t => !deleted.includes(t.collectionUid)) } : {}) });
                if (disabled && browser.alarms?.clear) await browser.alarms.clear(ALARM);
            }).catch(error => console.error('Auto-update recovery cleanup failed', error));
        }
        const withWindow = (windowId, task) => run(async () => {
            const initial = await ensure(); // before looking at ANY potentially reused window ID
            if (!browser.windows || (initial.chkResumeAutoUpdate && !supported())) return;
            const association = (initial.collectionsToTrack || []).find(t => t.windowId === windowId);
            const observedUpdate = updateRevision;
            const observedStop = stopRevisions.get(association?.collectionUid) || 0;
            const canPersist = async () => {
                const latest = await read();
                return latest.chkEnableAutoUpdate === true && updateRevision === observedUpdate &&
                    (stopRevisions.get(association?.collectionUid) || 0) === observedStop &&
                    !!association && (latest.collectionsToTrack || []).some(t =>
                        t.windowId === windowId && t.collectionUid === association.collectionUid);
            };
            const result = await task(canPersist);
            const data = await read();
            const tracked = (data.collectionsToTrack || []).find(t => t.windowId === windowId);
            if (tracked) await remember(tracked.collectionUid, windowId);
            return result;
        });
        return { track, close, stop, prune, tick, withWindow, storageChanged, activity, startup: () => run(() => ensure(true)) };
    }
    const api = { KEY, SESSION_KEY, ALARM, signature, createRecovery };
    globalThis.TaboxAutoUpdateRecovery = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
