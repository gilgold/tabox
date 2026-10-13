import AIChatAvatar from './AIChatAvatar';
import { syncSessionStateState } from '../atoms/globalAppSettingsState';
import AIHubActionCard from './AIHubActionCard';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { MdClose, MdDriveFileMoveOutline, MdFolderOpen, MdLink, MdRefresh, MdSend, MdGridView, MdEdit } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { aiProcessingUidsState } from '../atoms/aiState';
import { shareCollectionLinkModalState } from '../atoms/sharedFoldersState';
import { isProState } from '../atoms/premiumState';
import ProBadge from '../ProBadge';
import ShareCollectionLinkModal from '../ShareCollectionLinkModal';
import TaboxCollection from '../model/TaboxCollection';
import { applyUid } from '../utils';
import { loadAllCollections, loadAllFolders, loadSingleCollection } from '../utils/storageUtils';
import { moveCollectionToFolder } from '../utils/folderOperations';
import plannerCore from '../../chrome/task-planner-core';
import { getColorCode } from '../utils/colorUtils';
import { FALLBACK_FAVICON } from '../utils/sharedConstants';
import { showSuccessToast } from '../toastHelpers';
import { browser } from '../../static/globals';
import './TaskPlannerPanel.css';
import AIHubSuggestions from './AIHubSuggestions';
import { hasTabGroups } from '../utils/platform';

// chrome.storage.local key owned by the service worker's task-planner module.
// The panel renders EXCLUSIVELY from this session state: the initial
// taskPlannerStart reply plus the storage.onChanged subscription (the source
// of truth) — so a reopened popup reattaches to an in-flight chat for free.
const SESSION_KEY = 'taskPlannerSession';

// Rotating status lines shown while the AI is thinking. A random one is picked
// when the wait starts and swapped every few seconds, so a long wait never
// stares back with a frozen "Thinking…".
const THINKING_MESSAGES = [
    'Herding your tabs…',
    'Consulting the tab oracle…',
    'Untangling browser spaghetti…',
    'Counting your 147 open tabs…',
    'Asking the tabs to behave nicely…',
    'Doing suspiciously fast math…',
    'Reticulating splines…',
    'Negotiating with your bookmarks…',
    'Teaching tabs to stand in line…',
    'Rummaging through the tab drawer…',
    'Alphabetizing the chaos…',
    'Convincing tab 38 to cooperate…',
    'Bribing the algorithm…',
    'Summoning tidy vibes…',
    'Warming up the tab wrangler…',
    'Pretending to think really hard…',
    'Googling how to do this…',
    'Putting on its thinking hat…',
    'Shuffling pixels into place…',
    'Stalling, but charmingly…',
];

// How long a single funny line stays on screen before the next one.
const THINKING_ROTATE_MS = 2800;

// Random line, never the one already on screen (so a swap always looks like one).
const pickThinkingMsg = (prev) => {
    const pool = THINKING_MESSAGES.filter(m => m !== prev);
    const list = pool.length ? pool : THINKING_MESSAGES;
    return list[Math.floor(Math.random() * list.length)];
};

// Google's favicon service for gathered tabs (the model supplies no favIconUrl);
// a broken load falls back to the bundled placeholder via onError.
const faviconFor = (url) => {
    try {
        const { hostname } = new URL(url);
        if (hostname) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
    } catch {
        // Malformed URL — use the bundled fallback below.
    }
    return FALLBACK_FAVICON;
};

// Hub routes that answer inline in the chat and never open a tool card.
const CARDLESS_TOOLS = new Set(['clarify', 'find-tab']);

// Opens a saved tab found by the "find-tab" chat action (browser.tabs.create
// exists on both Chromium and Firefox).
const openFoundTab = (url) => browser.tabs.create({ url }).catch(() => {});

const handleFaviconError = (e) => {
    const img = e.currentTarget;
    if (!img.dataset.fellBack) {
        img.dataset.fellBack = '1';
        img.src = FALLBACK_FAVICON;
    }
};

// AI change choreography timings — must cover the CSS animation durations plus
// the per-row stagger (6 * 45ms) so nothing is cut off mid-animation.
const SCROLL_SETTLE_MS = 420;   // smooth-scroll settle before animations start
const VANISH_TOTAL_MS = 850;    // dematerialize (0.55s) + max stagger, then purge

// The materialize/dematerialize choreography is skipped entirely (rows just
// appear/disappear, with an instant scroll) when the user opted out of motion.
const motionDisabled = () => (
    (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    || document.documentElement.classList.contains('performance-mode')
);

// Merge AI-removed tabs back into the next groups at their old positions (and
// keep the shell of a fully-removed group) so they can dematerialize in place
// before being purged.
const mergeRemovedBack = (nextGroups, prevGroups, removedUids) => {
    const merged = nextGroups.map((g) => ({ ...g, tabs: [...(g.tabs || [])] }));
    const byUid = new Map(merged.map((g) => [g.uid, g]));
    prevGroups.forEach((pg, pgIndex) => {
        const removedTabs = (pg.tabs || []).filter((t) => removedUids.has(t.uid));
        if (!removedTabs.length) return;
        let target = byUid.get(pg.uid);
        if (!target) {
            target = { ...pg, tabs: [] };
            merged.splice(Math.min(pgIndex, merged.length), 0, target);
            byUid.set(target.uid, target);
        }
        (pg.tabs || []).forEach((t, i) => {
            if (removedUids.has(t.uid)) target.tabs.splice(Math.min(i, target.tabs.length), 0, t);
        });
    });
    return merged;
};

// Chat-style Task Planner panel (AI Tools modal, popup + full-page).
// The popup only initiates work and renders session state — every mutation
// (start/send/removeTab/reset) is a runtime message handled in the service
// worker, so closing the popup never aborts a turn.
function TaskPlannerPanel({ updateRemoteData, onDataUpdate, hub }) {
    const setAiProcessingUids = useSetAtom(aiProcessingUidsState);
    // Share chip → the globally mounted ShareCollectionLinkModal (App.js); it
    // handles sign-in + the Pro paywall itself, so the chip never pre-gates.
    const setShareCollectionLink = useSetAtom(shareCollectionLinkModalState);
    const isPro = useAtomValue(isProState);

    const [session, setSession] = useState(null);
    const [input, setInput] = useState('');
    const [shareTarget, setShareTarget] = useState(null);
    const chatUser = useAtomValue(syncSessionStateState)?.user;
    const sentActionRef = useRef(null);
    const mountedAtRef = useRef(Date.now());
    const sendingRef = useRef(false);
    const requestedActionRef = useRef(null);
    const [sending, setSending] = useState(false);
    const onHubAction = hub?.onAction;
    useEffect(() => {
        const action = session?.hubAction;
        if (!action || action.id === sentActionRef.current || !onHubAction) return;
        sentActionRef.current = action.id;
        const requestedAt = (session.messages || []).find(m => m.id === action.id)?.ts;
        if (!CARDLESS_TOOLS.has(action.tool)) onHubAction({ ...action, requestedAt, restoring: requestedAt < mountedAtRef.current });
    }, [session?.hubAction, onHubAction]);
    const [actionError, setActionError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [thinkingMsg, setThinkingMsg] = useState(() => pickThinkingMsg());
    // uids the user just removed — collapse them immediately while the SW write
    // is in flight (the storage change then drops them from the list for real).
    const [removingTabs, setRemovingTabs] = useState([]);

    // Inline collection picker ("Start from a collection"): while open it
    // temporarily replaces the .tp-groups area. pickerCollections: null =
    // metadata still loading, [] = user has no collections.
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerCollections, setPickerCollections] = useState(null);
    // uid of the row being fetched/loaded into the session (brief per-row
    // loading state; all rows are disabled while one is in flight).
    const [pickerLoadingUid, setPickerLoadingUid] = useState(null);

    // Inline folder picker ("Add to folder" offer chip): mirrors the
    // collection picker above and is mutually exclusive with it.
    // folderList: null = loading, [] = user has no folders.
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const [folderList, setFolderList] = useState(null);
    // uid of the folder a move is in flight to (all rows disabled meanwhile).
    const [folderMovingUid, setFolderMovingUid] = useState(null);

    // Editable collection name: seeded from the AI-suggested state value, but
    // once the user touches the field their edits win over later AI updates.
    const [nameDraft, setNameDraft] = useState('');
    const nameTouchedRef = useRef(false);

    // Guards the slow initial read against clobbering a fresher storage change
    // (same pattern as useSmartOrganizeUndo).
    const loadedRef = useRef(false);
    const sessionVersionRef = useRef(0);
    const messagesRef = useRef(null);
    const textareaRef = useRef(null);
    const flashTimerRef = useRef(null);

    // ── AI change choreography ──────────────────────────────────────────────
    // When an AI turn adds or removes tabs, the sidebar first scrolls to the
    // first changed row, THEN the rows materialize/dematerialize in place.
    // displayGroups is what actually renders: during a removal it briefly
    // keeps the removed tabs (merged back at their old spots) so they can
    // vanish visibly before being purged.
    const [displayGroups, setDisplayGroups] = useState([]);
    // null = idle. { stage, added:Set, removed:Set, instant:bool } otherwise.
    // 'hold': changed rows wait (added ones hidden) while the sidebar scrolls;
    // 'run': the materialize/dematerialize animations play.
    const [tabAnim, setTabAnim] = useState(null);
    const prevGroupsRef = useRef(null);     // last adopted session groups
    const prevSessionIdRef = useRef(null);  // diff only within the same session
    const removingTabsRef = useRef([]);     // mirror for the groups-diff effect
    const groupsScrollRef = useRef(null);   // the .tp-groups scroll container

    const messages = session?.messages || [];
    // Stable reference between renders — the diff effect keys off it.
    const groups = useMemo(() => session?.groups || [], [session]);
    const sessionId = session?.sessionId || null;
    const isThinking = session?.status === 'thinking';
    const onActivityChange = hub?.onActivityChange;
    useEffect(() => { onActivityChange?.(isThinking || sending || saving); }, [isThinking, sending, saving, onActivityChange]);
    // Set once the session is linked to a saved collection (after a save, or
    // after loading one via the picker) — Save becomes an in-place Update.
    const linkedUid = session?.linkedCollectionUid || null;
    const hasUserMessage = messages.some((m) => m.role === 'user');
    // Only the newest offer bubble carries the share / add-to-folder chips
    // (older offers keep their text but go quiet).
    const latestOfferId = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].offer) return messages[i].id;
        }
        return null;
    }, [messages]);
    const totalTabs = useMemo(() => groups.reduce((n, g) => n + ((g.tabs || []).length), 0), [groups]);

    // ── Session subscription ────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const adopt = (state) => {
            loadedRef.current = true;
            setSession(state || null);
        };

        (async () => {
            try {
                // Single unconditional start: the SW reuses a fresh session,
                // replaces one past its 24h expiry, and heals a stale
                // 'thinking' turn — so the panel never needs a getState-then-
                // start dance (which would skip the SW's expiry/heal path).
                // The SW writes the session to storage before replying, so a
                // live onChanged usually adopts it first; the reply covers
                // environments without the event.
                const started = await browser.runtime.sendMessage({ type: 'taskPlannerStart' });
                if (cancelled || loadedRef.current) return;
                if (started && started.ok) adopt(started.state);
                else if (started && started.error) setActionError(started.error);
            } catch (e) {
                console.error('Task Planner: failed to load session', e);
                if (!cancelled) setActionError('Could not reach Tabox AI. Please try again.');
            }
        })();

        const onChanged = (changes, area) => {
            if (area !== 'local' || !changes[SESSION_KEY]) return;
            sessionVersionRef.current += 1;
            loadedRef.current = true;
            setSession(changes[SESSION_KEY].newValue || null);
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => {
            cancelled = true;
            browser.storage.onChanged.removeListener(onChanged);
        };
    }, []);

    // Clear the flash timer on unmount.
    useEffect(() => () => {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    }, []);

    // Any wait that shows the bubble: planner thinking, a chat turn in flight, or
    // a hub tool working. Pick a fresh line when it starts, then rotate.
    const waiting = isThinking || sending || !!hub?.busy;
    useEffect(() => {
        if (!waiting) return undefined;
        setThinkingMsg(prev => pickThinkingMsg(prev));
        const id = setInterval(() => setThinkingMsg(prev => pickThinkingMsg(prev)), THINKING_ROTATE_MS);
        return () => clearInterval(id);
    }, [waiting]);

    // Seed the name field from the AI suggestion until the user edits it.
    const aiName = session?.collectionName || '';
    useEffect(() => {
        if (!nameTouchedRef.current) setNameDraft(aiName);
    }, [aiName]);

    // Keep the transcript pinned to the latest message.
    useEffect(() => {
        const el = messagesRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, isThinking, sending, hub?.busy, hub?.activeTool]);

    // Mirror removingTabs for the diff effect below (user-initiated removals
    // must not run the AI dematerialize choreography — they collapse inline).
    useEffect(() => { removingTabsRef.current = removingTabs; }, [removingTabs]);

    // Diff each adopted session groups set against the previous one, reconcile
    // the user-removal collapse list, and kick off the AI change choreography.
    useEffect(() => {
        const prevGroups = prevGroupsRef.current;
        const sameSession = sessionId !== null && sessionId === prevSessionIdRef.current;
        prevGroupsRef.current = groups;
        prevSessionIdRef.current = sessionId;

        const uids = new Set();
        for (const g of groups) for (const t of (g.tabs || [])) uids.add(t.uid);
        setRemovingTabs((prev) => (prev.length ? prev.filter((uid) => uids.has(uid)) : prev));

        // First adoption (mount/reattach) or a brand-new session: render as-is.
        if (!sameSession || prevGroups === null) {
            setDisplayGroups(groups);
            setTabAnim(null);
            return;
        }

        const prevUids = new Set();
        for (const g of prevGroups) for (const t of (g.tabs || [])) prevUids.add(t.uid);
        const added = new Set();
        for (const uid of uids) if (!prevUids.has(uid)) added.add(uid);
        const userRemoved = new Set(removingTabsRef.current);
        const removed = new Set();
        for (const uid of prevUids) if (!uids.has(uid) && !userRemoved.has(uid)) removed.add(uid);

        if (!added.size && !removed.size) {
            setDisplayGroups(groups);
            return;
        }
        if (motionDisabled()) {
            // No choreography — render the new set and jump-scroll to it.
            setDisplayGroups(groups);
            setTabAnim({ stage: 'hold', added, removed, instant: true });
            return;
        }
        setDisplayGroups(removed.size ? mergeRemovedBack(groups, prevGroups, removed) : groups);
        setTabAnim({ stage: 'hold', added, removed, instant: false });
    }, [groups, sessionId]);

    // 'hold' stage: scroll the sidebar to the first changed row, then release
    // the animations. Runs before paint so held (hidden) rows never flicker.
    useLayoutEffect(() => {
        if (!tabAnim || tabAnim.stage !== 'hold') return undefined;
        const container = groupsScrollRef.current;
        let wait = 0;
        if (container && container.scrollHeight > container.clientHeight + 4) {
            let target = null;
            for (const el of container.querySelectorAll('[data-tab-uid]')) {
                const uid = el.getAttribute('data-tab-uid');
                if (tabAnim.added.has(uid) || tabAnim.removed.has(uid)) { target = el; break; }
            }
            if (target) {
                const cRect = container.getBoundingClientRect();
                const tRect = target.getBoundingClientRect();
                if (tRect.top < cRect.top + 4 || tRect.bottom > cRect.bottom - 4) {
                    const top = container.scrollTop + (tRect.top - cRect.top) - (cRect.height - tRect.height) / 2;
                    const dest = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
                    if (typeof container.scrollTo === 'function') {
                        container.scrollTo({ top: dest, behavior: tabAnim.instant ? 'auto' : 'smooth' });
                    } else {
                        container.scrollTop = dest;
                    }
                    if (!tabAnim.instant) wait = SCROLL_SETTLE_MS;
                }
            }
        }
        if (tabAnim.instant) {
            setTabAnim(null);
            return undefined;
        }
        const release = () => setTabAnim((a) => (a && a.stage === 'hold' ? { ...a, stage: 'run' } : a));
        if (wait === 0) {
            release();
            return undefined;
        }
        const t = setTimeout(release, wait);
        return () => clearTimeout(t);
    }, [tabAnim]);

    // Purge dematerialized rows from the display once their animation is done.
    useEffect(() => {
        if (!tabAnim || tabAnim.stage !== 'run' || tabAnim.removed.size === 0) return undefined;
        const t = setTimeout(() => {
            setDisplayGroups(prevGroupsRef.current || []);
            // Keep `added` so still-staggering materialize rows finish cleanly.
            setTabAnim((a) => (a ? { ...a, removed: new Set() } : a));
        }, hub ? 510 : VANISH_TOTAL_MS);
        return () => clearTimeout(t);
    }, [tabAnim, Boolean(hub)]);

    // Stagger order for changed rows, in display order.
    const changeOrder = useMemo(() => {
        if (!tabAnim || tabAnim.instant) return null;
        const map = new Map();
        let i = 0;
        for (const g of displayGroups) {
            for (const t of (g.tabs || [])) {
                if (tabAnim.added.has(t.uid) || tabAnim.removed.has(t.uid)) map.set(t.uid, i++);
            }
        }
        return map;
    }, [displayGroups, tabAnim]);

    // Group shells kept alive only to host dematerializing tabs fade with them.
    const sessionGroupUids = useMemo(() => new Set(groups.map((g) => g.uid)), [groups]);

    // ── Actions (all mutations run in the service worker) ───────────────────
    const sendText = useCallback(async (text, action) => {
        const trimmed = (text || '').trim();
        if (!trimmed || isThinking || sendingRef.current || hub?.busy) return;
        sendingRef.current = true;
        setSending(true);
        setShareTarget(null);
        setActionError(null);
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        const version = sessionVersionRef.current;
        try {
            const res = await browser.runtime.sendMessage({ type: 'taskPlannerSend', payload: {
                text: trimmed,
                ...(hub ? { hub: true, action, activeTool: hub.activeTool, scope: hub.scope } : {}),
            } });
            if (res?.state && version === sessionVersionRef.current) setSession(res.state);
            if (res && res.ok === false && res.error) {
                setActionError(res.error);
            } else if (res && res.ignored) {
                // The SW acknowledged but did NOT append (a turn was already
                // thinking, or the text was empty server-side) — put the text
                // back in the composer instead of silently eating the message.
                setInput(trimmed);
            }
        } catch (e) {
            console.error('Task Planner: send failed', e);
            setActionError('Could not reach Tabox AI. Please try again.');
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, [isThinking, hub]);

    useEffect(() => {
        const request = hub?.request;
        if (!request || request.id === requestedActionRef.current || !session || isThinking || sending) return;
        requestedActionRef.current = request.id;
        sendText(request.label, { tool: request.tool, uids: request.uids || [] });
    }, [hub?.request, session, isThinking, sending, sendText]);

    const handleRemoveTab = useCallback(async (groupUid, tabUid) => {
        // Optimistic collapse; a failed removal must un-collapse the row, or the
        // tab stays hidden while it's still in the SW session (phantom removal).
        setRemovingTabs((prev) => (prev.includes(tabUid) ? prev : [...prev, tabUid]));
        try {
            const res = await browser.runtime.sendMessage({ type: 'taskPlannerRemoveTab', payload: { groupUid, tabUid } });
            if (!res || !res.ok) {
                setRemovingTabs((prev) => prev.filter((uid) => uid !== tabUid));
                setActionError((res && res.error) || 'Could not remove the tab.');
            }
        } catch (e) {
            console.error('Task Planner: remove tab failed', e);
            setRemovingTabs((prev) => prev.filter((uid) => uid !== tabUid));
            setActionError('Could not remove the tab.');
        }
    }, []);

    // Spin up a fresh batch of suggestion pills. The SW flips pills to null
    // (skeletons + spinning icon render from that) and lands the new batch via
    // storage.onChanged; the reply only carries failures worth surfacing.
    const handleRefreshPills = useCallback(async () => {
        setActionError(null);
        const version = sessionVersionRef.current;
        try {
            const res = await browser.runtime.sendMessage({ type: 'taskPlannerRefreshPills', ...(hub ? { payload: { hub: true } } : {}) });
            if (res?.state && version === sessionVersionRef.current) setSession(res.state);
            if (res && res.ok === false && res.error) setActionError(res.error);
        } catch (e) {
            console.error('Task Planner: pill refresh failed', e);
            setActionError('Could not fetch new ideas. Please try again.');
        }
    }, [Boolean(hub)]);

    const resetLocal = useCallback(() => {
        nameTouchedRef.current = false;
        setNameDraft('');
        setShareTarget(null);
        setInput('');
        setRemovingTabs([]);
        setPickerOpen(false);
        setPickerLoadingUid(null);
        setFolderPickerOpen(false);
        setFolderList(null);
        setFolderMovingUid(null);
        prevGroupsRef.current = null;
        prevSessionIdRef.current = null;
        setDisplayGroups([]);
        setTabAnim(null);
    }, []);

    const handleNewPlan = useCallback(async () => {
        if (saving || isThinking || sendingRef.current || hub?.busy || removingTabs.length) return;
        sendingRef.current = true;
        setSending(true);
        setActionError(null);
        // Invalidate a suggestion refresh that was started in the old chat.
        sessionVersionRef.current += 1;
        // Clear the UI first — a new chat is a local reset, so it must paint
        // immediately instead of waiting on the service worker round trips
        // (the empty chat is what the SW is about to store anyway). If the SW
        // then fails, the previous session is put back below.
        const previousSession = session;
        resetLocal();
        setSession(null);
        hub?.onReset?.();
        textareaRef.current?.focus();
        try {
            const reset = await browser.runtime.sendMessage({ type: 'taskPlannerReset' });
            if (reset?.ok === false) throw new Error(reset.error || 'Could not clear the chat.');
            const started = await browser.runtime.sendMessage({ type: 'taskPlannerStart', payload: { force: true } });
            if (!started?.ok) throw new Error(started?.error || 'Could not start a new chat.');
            loadedRef.current = true;
            setSession(started.state);
        } catch (e) {
            // The optimistic clear didn't stick — restore what the user had.
            setSession(previousSession || null);
            setActionError(e.message || 'Could not start a new chat. Please try again.');
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, [saving, isThinking, hub, removingTabs.length, resetLocal, session]);

    // Save flow — build the collection from the session's groups and persist
    // it through updateRemoteData. The chat is NOT reset: the session stays
    // linked to the saved collection (taskPlannerMarkSaved / the existing
    // link), so the user keeps refining and re-saving in place.
    const handleSave = useCallback(async () => {
        if (saving || totalTabs === 0) return;
        setSaving(true);
        setActionError(null);
        try {
            const name = (nameDraft || aiName || 'Task Plan').trim() || 'Task Plan';
            const chromeGroups = groups.map((g, i) => ({ id: i + 1, title: g.title, color: g.color, collapsed: false }));
            const tabs = groups.flatMap((g, i) => (g.tabs || []).map((t) => ({
                url: t.url,
                title: t.title,
                favIconUrl: '',
                pinned: false,
                active: false,
                groupId: i + 1,
            })));
            const all = await loadAllCollections();
            // Linked session → update the collection IN PLACE (same uid, same
            // spot in the list). A linked-but-deleted collection falls through
            // to the create path below and re-links to the new uid.
            const existing = linkedUid ? all.find((c) => c.uid === linkedUid) : null;
            let flashUid;
            if (existing) {
                // applyUid wires tab.uid/group.uid/tab.groupUid so group counts
                // and future edits behave like any hand-saved collection.
                let updated = new TaboxCollection(name, tabs, chromeGroups);
                updated = applyUid(updated);
                // Preserve identity/metadata from the stored record — only the
                // name/tabs/groups come from the planner session.
                updated.uid = existing.uid;
                updated.parentId = existing.parentId ?? null;
                updated.color = existing.color;
                updated.createdOn = existing.createdOn;
                updated.order = existing.order;
                updated.isFavorite = existing.isFavorite;
                updated.favoriteOrder = existing.favoriteOrder;
                await updateRemoteData(all.map((c) => (c.uid === existing.uid ? updated : c)));
                showSuccessToast('Collection updated!');
                flashUid = existing.uid;
            } else {
                const collection = applyUid(new TaboxCollection(name, tabs, chromeGroups));
                await updateRemoteData([...all, collection]);
                showSuccessToast('Collection saved!');
                flashUid = collection.uid;
                // Link the session to the saved collection so the next save
                // updates it in place (storage.onChanged delivers the linked
                // state back). Best-effort: the save itself already succeeded.
                try {
                    await browser.runtime.sendMessage({
                        type: 'taskPlannerMarkSaved',
                        payload: { uid: collection.uid, name },
                    });
                } catch (linkError) {
                    console.error('Task Planner: mark-saved failed', linkError);
                }
            }
            if (typeof onDataUpdate === 'function') {
                Promise.resolve(onDataUpdate()).catch(() => {});
            }
            // AI flash on the collection card (aiProcessingUidsState drives
            // the shared .ai-processing-overlay on the list card).
            setAiProcessingUids((prev) => (prev.includes(flashUid) ? prev : [...prev, flashUid]));
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => {
                setAiProcessingUids((prev) => prev.filter((uid) => uid !== flashUid));
            }, 2500);
        } catch (e) {
            console.error('Task Planner: save failed', e);
            setActionError('Could not save the collection. Please try again.');
        } finally {
            setSaving(false);
        }
    }, [saving, totalTabs, nameDraft, aiName, groups, linkedUid, updateRemoteData, onDataUpdate, setAiProcessingUids]);

    // Share the linked collection via the global share-link modal. The modal
    // needs the FULL stored record (it snapshots name + tabs + groups).
    const handleShareLink = useCallback(async () => {
        setActionError(null);
        try {
            const full = linkedUid ? await loadSingleCollection(linkedUid) : null;
            if (!full) {
                setActionError('Could not find the saved collection. Try saving again.');
                return;
            }
            if (hub) setShareTarget(full);
            else setShareCollectionLink(full);
        } catch (e) {
            console.error('Task Planner: share link failed', e);
            setActionError('Could not find the saved collection. Try saving again.');
        }
    }, [linkedUid, setShareCollectionLink, Boolean(hub)]);

    // ── Add to folder (offer chip) ──────────────────────────────────────────
    const openFolderPicker = useCallback(async () => {
        setShareTarget(null);
        hub?.onAction?.({ tool: 'task-planner', uids: [] });
        setActionError(null);
        setPickerOpen(false); // mutually exclusive with the collection picker
        setFolderPickerOpen(true);
        setFolderList(null);
        try {
            const folders = await loadAllFolders({ metadataOnly: true });
            setFolderList(folders || []);
        } catch (e) {
            console.error('Task Planner: could not list folders', e);
            setFolderList([]);
            setActionError('Could not load your folders. Please try again.');
        }
    }, [hub?.onAction]);

    // Move the linked collection into the picked folder. moveCollectionToFolder
    // does its own read-only shared-folder check ({ blocked: true }) and syncs
    // folder counts — the panel only refreshes the UI and reports the outcome.
    const handleFolderPick = useCallback(async (folder) => {
        if (folderMovingUid || !linkedUid) return;
        setActionError(null);
        setFolderMovingUid(folder.uid);
        try {
            const res = await moveCollectionToFolder(linkedUid, folder.uid);
            if (res === true) {
                if (typeof onDataUpdate === 'function') {
                    await Promise.resolve(onDataUpdate()).catch(() => {});
                }
                showSuccessToast(`Moved "${(nameDraft || aiName || 'collection').trim()}" to ${folder.name}`);
                setFolderPickerOpen(false);
            } else if (res && res.blocked) {
                setActionError("This folder is shared read-only — you can't move collections into it.");
            } else {
                setActionError('Could not move the collection. Please try again.');
            }
        } catch (e) {
            console.error('Task Planner: move to folder failed', e);
            setActionError('Could not move the collection. Please try again.');
        } finally {
            setFolderMovingUid(null);
        }
    }, [folderMovingUid, linkedUid, onDataUpdate, nameDraft, aiName]);

    // ── Choose Collection (start from an existing collection) ───────────────
    const openPicker = useCallback(async () => {
        if (isThinking || saving) return;
        setActionError(null);
        setFolderPickerOpen(false); // mutually exclusive with the folder picker
        setPickerOpen(true);
        setPickerCollections(null);
        try {
            const metas = await loadAllCollections({ metadataOnly: true });
            // Most recently touched first.
            const sorted = [...(metas || [])].sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
            setPickerCollections(sorted);
        } catch (e) {
            console.error('Task Planner: could not list collections', e);
            setPickerCollections([]);
            setActionError('Could not load your collections. Please try again.');
        }
    }, [isThinking, saving]);

    const handlePick = useCallback(async (uid) => {
        if (pickerLoadingUid) return;
        setActionError(null);
        setPickerLoadingUid(uid);
        try {
            const full = await loadSingleCollection(uid);
            if (!full) {
                setActionError('Could not load that collection.');
                return;
            }
            const plannerGroups = plannerCore.collectionToPlannerGroups(full);
            const res = await browser.runtime.sendMessage({
                type: 'taskPlannerLoadCollection',
                payload: { uid, name: full.name, groups: plannerGroups },
            });
            if (!res || res.ok === false) {
                setActionError((res && res.error) || 'Could not load that collection.');
                return;
            }
            if (res.ignored) {
                // A turn is mid-flight in the SW — nothing was loaded.
                setActionError('Please wait for the current reply to finish.');
                return;
            }
            // Linked state renders via storage.onChanged (the SW also appends
            // an assistant bubble announcing the load).
            setPickerOpen(false);
        } catch (e) {
            console.error('Task Planner: load collection failed', e);
            setActionError('Could not load that collection.');
        } finally {
            setPickerLoadingUid(null);
        }
    }, [pickerLoadingUid]);

    // ── Composer ────────────────────────────────────────────────────────────
    const autogrow = () => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        // ~4 lines max (18px line-height + 16px vertical padding).
        el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
    };

    const handleInputChange = (e) => {
        setInput(e.target.value);
        autogrow();
    };

    const handleKeyDown = (e) => {
        // IME composition: Enter confirms the composed text, not a send.
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendText(input);
        }
    };

    // Pills show until the first user message; null = still loading (render
    // skeletons), [] = generation failed with no fallback (render nothing).
    const pills = session?.pills;
    const showPills = !hasUserMessage && session !== null && (pills === null || (Array.isArray(pills) && pills.length > 0));

    const plannerCard = (<div className="tp-tabs-panel">
                    <div className="tp-tabs-header">
                        <div className="tp-tabs-header-row">
                            <input
                                type="text"
                                className="tp-collection-name"
                                aria-label="Collection name"
                                placeholder="Collection name"
                                value={nameDraft}
                                onChange={(e) => {
                                    nameTouchedRef.current = true;
                                    setNameDraft(e.target.value);
                                }}
                            />
                            {!linkedUid && (
                                <button
                                    type="button"
                                    className="tp-choose-btn"
                                    aria-label="Start from a collection"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Start from a collection"
                                    data-tooltip-class-name="small-tooltip"
                                    disabled={isThinking || saving}
                                    onClick={openPicker}
                                >
                                    <MdFolderOpen size={16} />
                                </button>
                            )}
                        </div>
                        <span className="tp-tab-count">{totalTabs} tab{totalTabs === 1 ? '' : 's'}</span>
                    </div>
                    {pickerOpen ? (
                        <div className="tp-picker" data-testid="tp-picker">
                            <div className="tp-picker-header">
                                <span className="tp-picker-title">Choose a collection</span>
                                <button
                                    type="button"
                                    className="tp-picker-close"
                                    aria-label="Close collection picker"
                                    onClick={() => setPickerOpen(false)}
                                >
                                    <MdClose size={14} />
                                </button>
                            </div>
                            <div className="tp-picker-list">
                                {pickerCollections === null && (
                                    <p className="tp-groups-empty">Loading your collections…</p>
                                )}
                                {Array.isArray(pickerCollections) && pickerCollections.length === 0 && (
                                    <p className="tp-groups-empty">No saved collections yet.</p>
                                )}
                                {Array.isArray(pickerCollections) && pickerCollections.map((c) => (
                                    <button
                                        type="button"
                                        key={c.uid}
                                        className={`tp-picker-row${pickerLoadingUid === c.uid ? ' tp-picker-row--loading' : ''}`}
                                        disabled={!!pickerLoadingUid}
                                        onClick={() => handlePick(c.uid)}
                                    >
                                        <span className="tp-picker-row-name">{c.name}</span>
                                        <span className="tp-picker-row-count">
                                            {pickerLoadingUid === c.uid
                                                ? 'Loading…'
                                                : `${c.tabCount || 0} tab${(c.tabCount || 0) === 1 ? '' : 's'}`}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : folderPickerOpen ? (
                        <div className="tp-picker" data-testid="tp-folder-picker">
                            <div className="tp-picker-header">
                                <span className="tp-picker-title">Add to folder</span>
                                <button
                                    type="button"
                                    className="tp-picker-close"
                                    aria-label="Close folder picker"
                                    onClick={() => setFolderPickerOpen(false)}
                                >
                                    <MdClose size={14} />
                                </button>
                            </div>
                            <div className="tp-picker-list">
                                {folderList === null && (
                                    <p className="tp-groups-empty">Loading your folders…</p>
                                )}
                                {Array.isArray(folderList) && folderList.length === 0 && (
                                    <p className="tp-groups-empty">No folders yet.</p>
                                )}
                                {Array.isArray(folderList) && folderList.map((f) => (
                                    <button
                                        type="button"
                                        key={f.uid}
                                        className={`tp-picker-row${folderMovingUid === f.uid ? ' tp-picker-row--loading' : ''}`}
                                        disabled={!!folderMovingUid}
                                        onClick={() => handleFolderPick(f)}
                                    >
                                        <span className="tp-picker-row-name">{f.name}</span>
                                        {folderMovingUid === f.uid && (
                                            <span className="tp-picker-row-count">Moving…</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                    <div className="tp-groups" ref={groupsScrollRef}>
                        {displayGroups.length === 0 && (
                            <>
                                <p className="tp-groups-empty">Websites the AI gathers for your plan will appear here.</p>
                                {!linkedUid && (
                                    <button
                                        type="button"
                                        className="tp-choose-link"
                                        disabled={isThinking || saving}
                                        onClick={openPicker}
                                    >
                                        Start from a collection
                                    </button>
                                )}
                            </>
                        )}
                        {displayGroups.map((g, gi) => {
                            // Shell kept alive only for its dematerializing tabs.
                            const groupVanishing = tabAnim && !tabAnim.instant
                                && tabAnim.stage === 'run' && !sessionGroupUids.has(g.uid);
                            return (
                            <div
                                key={g.uid}
                                className={`tp-group${groupVanishing ? ' tp-group--vanishing' : ''}`}
                                style={{ borderLeftColor: getColorCode(g.color), animationDelay: `${Math.min(gi, 6) * 0.07}s` }}
                            >
                                <div className="tp-group-title">{g.title}</div>
                                <ul className="tp-group-tabs">
                                    {(g.tabs || []).map((t) => {
                                        // AI choreography classes: hidden hold →
                                        // materialize; in-place dematerialize.
                                        let animClass = '';
                                        if (tabAnim && !tabAnim.instant) {
                                            if (tabAnim.added.has(t.uid)) {
                                                animClass = tabAnim.stage === 'hold' ? ' tp-tab--holding' : ' tp-tab--materializing';
                                            } else if (tabAnim.removed.has(t.uid) && tabAnim.stage === 'run') {
                                                animClass = ' tp-tab--vanishing';
                                            }
                                        }
                                        const animDelay = animClass && tabAnim.stage === 'run'
                                            ? `${Math.min((changeOrder && changeOrder.get(t.uid)) || 0, 6) * 45}ms`
                                            : undefined;
                                        return (
                                        <li
                                            key={t.uid}
                                            data-tab-uid={t.uid}
                                            className={`tp-tab${animClass}${removingTabs.includes(t.uid) ? ' tp-tab--removing' : ''}`}
                                            style={animDelay ? { animationDelay: animDelay } : undefined}
                                        >
                                            <img
                                                className="tp-tab-favicon"
                                                src={faviconFor(t.url)}
                                                alt=""
                                                onError={handleFaviconError}
                                            />
                                            <span className="tp-tab-title">{t.title || t.url}</span>
                                            <button
                                                type="button"
                                                className="tp-tab-remove"
                                                aria-label="Remove tab"
                                                data-tooltip-id="main-tooltip"
                                                data-tooltip-content="Remove tab"
                                                data-tooltip-class-name="small-tooltip"
                                                // Disabled mid-turn: the AI reply lands the full tab set
                                                // computed from the pre-removal snapshot, which would
                                                // silently resurrect a tab removed while it was thinking.
                                                disabled={isThinking}
                                                onClick={() => handleRemoveTab(g.uid, t.uid)}
                                            >
                                                <MdClose size={14} />
                                            </button>
                                        </li>
                                        );
                                    })}
                                </ul>
                            </div>
                            );
                        })}
                    </div>
                    )}
                    <div className="tp-tabs-footer">
                        {actionError && <div className="tp-error">{actionError}</div>}
                        <button
                            type="button"
                            className="ai-tool-action-btn tp-save-btn"
                            onClick={handleSave}
                            // Locked mid-turn (the AI reply would land after saving a
                            // stale set) and while removals are pending (the removed
                            // tabs aren't out of the SW session yet).
                            disabled={totalTabs === 0 || saving || isThinking || removingTabs.length > 0}
                        >
                            <BsStars size={14} style={{ marginRight: '6px' }} />
                            {saving ? 'Saving…' : (linkedUid ? 'Update collection' : 'Save collection')}
                        </button>
                        <button
                            type="button"
                            className="tp-new-plan-btn"
                            onClick={handleNewPlan}
                            disabled={saving || isThinking || sending || removingTabs.length > 0}
                        >
                            New plan
                        </button>
                    </div>
                </div>);
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const hasPlanningInput = Boolean(lastUserMessage && !['Plan something', 'Plan something new', 'Task Planner'].includes(lastUserMessage.content));
    const showCollectionPanel = Boolean(hub && hub.activeTool === 'task-planner' && (groups.length || linkedUid || hasPlanningInput));
    const tabPositionsRef = useRef(new Map());
    useLayoutEffect(() => {
        if (!showCollectionPanel) { tabPositionsRef.current.clear(); return undefined; }
        const nodes = Array.from(groupsScrollRef.current?.querySelectorAll('[data-tab-uid]') || []);
        const previous = tabPositionsRef.current;
        const next = new Map(nodes.map(node => [node.dataset.tabUid, { rect: node.getBoundingClientRect(), text: node.textContent }]));
        tabPositionsRef.current = next;
        if (motionDisabled()) return undefined;
        const animations = [];
        for (const node of nodes) {
            const before = previous.get(node.dataset.tabUid);
            const after = next.get(node.dataset.tabUid);
            if (!before || typeof node.animate !== 'function' || node.classList.contains('tp-tab--vanishing')) continue;
            const dx = before.rect.x - after.rect.x;
            const dy = before.rect.y - after.rect.y;
            if (dx || dy) animations.push(node.animate([
                { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' },
            ], { duration: 280, easing: 'cubic-bezier(.65,0,.35,1)' }));
            else if (before.text !== after.text) animations.push(node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }));
        }
        const cancel = () => animations.forEach(animation => animation.cancel());
        const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const onChange = () => { if (media.matches) cancel(); };
        media?.addEventListener?.('change', onChange);
        return () => { cancel(); media?.removeEventListener?.('change', onChange); };
    }, [showCollectionPanel, displayGroups, tabAnim?.stage]);
    const onPlanningLayout = hub?.onPlanningLayout;
    useEffect(() => { onPlanningLayout?.(showCollectionPanel); }, [showCollectionPanel, onPlanningLayout]);
    const inlineCard = shareTarget
        ? <ShareCollectionLinkModal inlineCollection={shareTarget} onInlineClose={() => setShareTarget(null)} />
        : hub?.unavailable || showCollectionPanel || CARDLESS_TOOLS.has(session?.hubAction?.tool) ? null
            : hub?.activeTool === 'task-planner' ? (pickerOpen || folderPickerOpen ? plannerCard : <AIHubActionCard title={totalTabs ? `${nameDraft || aiName || 'Your plan'} · ${totalTabs} tabs` : 'Start your plan'}
                description={totalTabs ? groups.map(g => g.title).join(' · ') : 'Tell me what you’re planning, or choose a saved collection.'}
                primary={totalTabs ? { label: linkedUid ? 'Update collection' : 'Save collection', onClick: handleSave, disabled: saving || isThinking || removingTabs.length > 0 } : { label: 'Start from a collection', onClick: openPicker }}>
                {plannerCard}
            </AIHubActionCard>) : hub?.panel;
    const welcome = hub && session !== null && !hasUserMessage && !hub.activeTool && !hub.showActions && !sending && !isThinking;
    const showFollowUps = hub && hasUserMessage && !isThinking && !sending && !hub.busy && (hub.completed || !inlineCard);

    // Lives beside the "Tabox AI" title (portaled into the modal header when the
    // host provides a slot); falls back inline so the panel works standalone.
    const newChatButton = hub ? (
        <button type="button" className="tp-new-plan-btn ai-hub-new-chat" onClick={handleNewPlan}
            disabled={saving || isThinking || sending || hub.busy || removingTabs.length > 0}
            data-tooltip-id="main-tooltip" data-tooltip-content="Clear this conversation and start a new chat">
            <MdEdit size={14} aria-hidden="true" /><span>New Chat</span>
        </button>
    ) : null;
    return (
        <div className={`tp-root${hub ? ' ai-hub-conversation' : ''}${welcome ? ' ai-hub-welcome' : ''}${showCollectionPanel ? ' ai-hub-with-collection' : ''}${hub && hub.activeTool !== 'task-planner' ? ' ai-hub-conversation--tool' : ''}${hub && !hub.panel && hub.activeTool !== 'task-planner' ? ' ai-hub-conversation--empty' : ''}`}>
            <div className="tp-layout">
                <div className="tp-chat">
                    <div className="tp-messages" ref={messagesRef}>
                        {welcome && <div className="ai-hub-welcome-copy">
                            <h2>What would you like to do?</h2>
                            <p>A little help with your tabs and collections.</p>
                            <div className="ai-hub-start-prompts">
                                <button type="button" className="tp-pill" onClick={() => sendText('Plan something', { tool: 'task-planner', uids: [] })}>Plan something</button>
                                {hasTabGroups() && <button type="button" className="tp-pill" onClick={() => sendText('Organize my tabs', { tool: 'smart-organize', uids: [] })}>Organize my tabs</button>}
                                <button type="button" className="tp-pill" onClick={() => sendText('Tidy my collections')}>Tidy my collections</button>
                                <button type="button" className="tp-pill" onClick={() => sendText('Find a saved tab', { tool: 'find-tab', uids: [] })}>Find a saved tab</button>
                            </div>
                        </div>}

                        {session === null && !actionError && (
                            <div className="tp-msg tp-msg--assistant" aria-hidden="true">
                                <AIChatAvatar />
                                <div className="tp-bubble tp-bubble--skeleton" />
                            </div>
                        )}
                        {!hub && session?.greeting && (
                            <div className="tp-msg tp-msg--assistant">
                                <AIChatAvatar />
                                <div className="tp-bubble">{hub ? 'What would you like to do? Plan something new, organize your tabs, or tidy your collections.' : session.greeting}</div>
                            </div>
                        )}
                        {messages.filter(m => !(hub?.unavailable && m.role === 'assistant' && m.content === session?.hubAction?.reply)).map((m, i) => (
                            <React.Fragment key={m.id}>
                                <div
                                    className={`tp-msg ${m.role === 'user' ? 'tp-msg--user' : 'tp-msg--assistant'}`}
                                    style={{ animationDelay: `${Math.min(i, 6) * 0.05}s` }}
                                >
                                    {m.role === 'assistant' && <AIChatAvatar />}
                                    <div className="tp-bubble">{m.content}</div>
                                    {m.role === 'user' && <AIChatAvatar role="user" user={chatUser} />}
                                </div>
                                {Array.isArray(m.tabResults) && m.tabResults.length > 0 && (
                                    <ul className="tp-tab-results" data-testid="tp-tab-results">
                                        {m.tabResults.map((r) => (
                                            <li key={`${r.collectionUid}:${r.url}`}>
                                                <button
                                                    type="button"
                                                    className="tp-tab-result"
                                                    onClick={() => openFoundTab(r.url)}
                                                    data-tooltip-id="main-tooltip"
                                                    data-tooltip-content={r.url}
                                                    data-tooltip-class-name="small-tooltip"
                                                >
                                                    <img className="tp-tab-favicon" src={r.favIconUrl || faviconFor(r.url)} alt="" onError={handleFaviconError} />
                                                    <span className="tp-tab-result-title">{r.title}</span>
                                                    <span className="tp-tab-result-collection">{r.collectionName}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {m.offer && m.id === latestOfferId && !!linkedUid && (
                                    <div className="tp-offer-chips" data-testid="tp-offer-chips">
                                        <button
                                            type="button"
                                            className="tp-pill tp-offer-chip"
                                            disabled={isThinking || saving}
                                            onClick={handleShareLink}
                                        >
                                            <MdLink size={14} aria-hidden="true" />
                                            Share via link
                                            {!isPro && <ProBadge />}
                                        </button>
                                        <button
                                            type="button"
                                            className="tp-pill tp-offer-chip"
                                            disabled={isThinking || saving}
                                            onClick={openFolderPicker}
                                        >
                                            <MdDriveFileMoveOutline size={14} aria-hidden="true" />
                                            Add to folder
                                        </button>
                                    </div>
                                )}
                            </React.Fragment>
                        ))}
                        {hub?.actions}
                        {(isThinking || (hub && (sending || hub.busy))) && (
                            <div className="tp-msg tp-msg--assistant" data-testid="tp-thinking">
                                <AIChatAvatar />
                                <div className="tp-bubble tp-thinking" role="status" aria-live="polite">
                                    <span className="tp-thinking-text">{thinkingMsg}</span>
                                </div>
                            </div>
                        )}
                        {hub && inlineCard && !isThinking && !sending && (
                            <section className="ai-hub-action-card" aria-label="AI action" key={shareTarget ? 'share' : hub.activeTool}>
                                {inlineCard}
                            </section>
                        )}

                        {hub?.unavailable && !isThinking && !sending && <div className="tp-msg tp-msg--assistant">
                            <AIChatAvatar />
                            <div className="tp-bubble">{hub.unavailable}</div>
                        </div>}
                        {session?.status === 'error' && session.error && (
                            <div className="tp-msg tp-msg--assistant">
                                <AIChatAvatar />
                                <div className="tp-bubble tp-bubble--error">{session.error}</div>
                            </div>
                        )}
                    </div>


                    {!hub && showPills && (
                        <div className="tp-pills" data-testid="tp-pills">
                            {pills === null && [0, 1, 2].map((i) => (
                                <span key={i} className="tp-pill tp-pill--skeleton" data-testid="tp-pill-skeleton" aria-hidden="true" />
                            ))}
                            {Array.isArray(pills) && pills.map((pill, i) => (
                                <button
                                    key={pill}
                                    type="button"
                                    className="tp-pill"
                                    style={{ animationDelay: `${i * 0.06}s` }}
                                    onClick={() => sendText(pill)}
                                    disabled={isThinking}
                                >
                                    {pill}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={`tp-pills-refresh${pills === null ? ' tp-pills-refresh--spinning' : ''}`}
                                aria-label="New ideas"
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content="New ideas"
                                data-tooltip-class-name="small-tooltip"
                                // Disabled while a batch is already generating (it
                                // spins instead) or a turn is in flight.
                                disabled={pills === null || isThinking}
                                onClick={handleRefreshPills}
                            >
                                <MdRefresh size={15} />
                            </button>
                        </div>
                    )}

                    {showFollowUps && <AIHubSuggestions limit={2} quiet collections={hub.collections || []} scope={hub.scope} activeTool={hub.activeTool}
                        followUps={session?.followUps} disabled={isThinking || sending || hub.busy}
                        onRefresh={handleRefreshPills} onSelect={suggestion => sendText(suggestion.label, suggestion.tool ? { tool: suggestion.tool, uids: suggestion.uids || [] } : undefined)} />}
                    <div className="tp-composer">
                        {hub && <button type="button" className="ai-hub-more" aria-label="More AI actions" aria-expanded={!!hub.showActions}
                            disabled={isThinking || sending || hub.busy} onClick={hub.onToggleActions}><MdGridView size={20} /></button>}
                        <textarea
                            ref={textareaRef}
                            className="tp-input"
                            rows={1}
                            placeholder={hub ? 'Ask Tabox AI…' : 'Describe what you’re planning…'}
                            aria-label="Message Tabox AI"
                            maxLength={4000}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            disabled={isThinking || sending || hub?.busy || session === null}
                        />
                        <button
                            type="button"
                            className="tp-send-btn"
                            aria-label="Send message"
                            onClick={() => sendText(input)}
                            disabled={isThinking || sending || hub?.busy || session === null || !input.trim()}
                        >
                            <MdSend size={16} />
                        </button>
                    </div>
                    {hub && actionError && <div className="tp-error" role="alert">{actionError}</div>}
                    {hub && <div className="ai-hub-chat-toolbar">
                        {hub.toolbar}
                        {hub.headerSlot ? createPortal(newChatButton, hub.headerSlot) : newChatButton}
                    </div>}
                </div>

                {showCollectionPanel && <aside className="ai-hub-collection-panel" aria-label="Current collection">
                    <div className="ai-hub-collection-caption">Current collection{isThinking && <span role="status">Updating…</span>}</div>
                    {plannerCard}
                </aside>}
                {!hub && plannerCard}
            </div>
        </div>
    );
}

export default TaskPlannerPanel;
