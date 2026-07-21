import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MdClose, MdDeleteOutline, MdSend } from 'react-icons/md';
import { isProState } from '../atoms/premiumState';
import { selectedCollectionUidState } from '../atoms/globalAppSettingsState';
import { browser } from '../../static/globals';
import { showErrorToast } from '../toastHelpers';
import ProBadge from '../ProBadge';
import './FPSharedPanel.css';

const POLL_INTERVAL_MS = 30000;
const SYNC_STATE_KEY = 'shared_sync_state';
const SEEN_KEY = 'shared_activity_seen';

/**
 * Unread-dot state for a shared folder's activity feed.
 * Unread = shared_sync_state[folderId].lastActivityId (written by the
 * background delta sync) > shared_activity_seen[folderId] (written by this
 * panel when the Activity tab is opened). Subscribes to storage.onChanged so
 * the dot updates live while the full page stays open.
 */
export function useSharedActivityUnread(folderId) {
    const [unread, setUnread] = useState(false);

    useEffect(() => {
        if (!folderId) {
            setUnread(false);
            return undefined;
        }
        let live = true;
        const compute = async () => {
            try {
                const stored = await browser.storage.local.get([SYNC_STATE_KEY, SEEN_KEY]);
                if (!live) return;
                const lastActivityId = stored?.[SYNC_STATE_KEY]?.[folderId]?.lastActivityId || 0;
                const lastSeenId = stored?.[SEEN_KEY]?.[folderId] || 0;
                setUnread(lastActivityId > lastSeenId);
            } catch {
                if (live) setUnread(false);
            }
        };
        compute();
        const listener = (changes, areaName) => {
            if (areaName && areaName !== 'local') return;
            if (changes[SYNC_STATE_KEY] || changes[SEEN_KEY]) compute();
        };
        browser.storage.onChanged.addListener(listener);
        return () => {
            live = false;
            browser.storage.onChanged.removeListener(listener);
        };
    }, [folderId]);

    return unread;
}

/** Persist "seen up to the latest synced activity id" for a folder. */
export async function markActivitySeen(folderId) {
    if (!folderId) return;
    try {
        const stored = await browser.storage.local.get([SYNC_STATE_KEY, SEEN_KEY]);
        const lastActivityId = stored?.[SYNC_STATE_KEY]?.[folderId]?.lastActivityId || 0;
        const seen = { ...(stored?.[SEEN_KEY] || {}) };
        if ((seen[folderId] || 0) >= lastActivityId) return;
        seen[folderId] = lastActivityId;
        await browser.storage.local.set({ [SEEN_KEY]: seen });
    } catch {
        // Best effort — the dot simply stays until the next successful write.
    }
}

export function formatRelativeTime(timestamp, nowMs = Date.now()) {
    if (!timestamp) return '';
    const diffMinutes = Math.floor(Math.max(0, nowMs - timestamp) / 60000);
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

const isSameDay = (a, b) => (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
);

export function formatDayLabel(timestamp, nowMs = Date.now()) {
    const date = new Date(timestamp);
    const today = new Date(nowMs);
    if (isSameDay(date, today)) return 'Today';
    const yesterday = new Date(nowMs);
    yesterday.setDate(yesterday.getDate() - 1);
    if (isSameDay(date, yesterday)) return 'Yesterday';
    const options = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== today.getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString(undefined, options);
}

const parseDetail = (detail) => {
    if (!detail) return {};
    if (typeof detail === 'object') return detail;
    try {
        return JSON.parse(detail) || {};
    } catch {
        return {};
    }
};

/**
 * Human sentence for one activity event. `selfEmail` must be lowercase; the
 * signed-in user is rendered as "You"/"you" instead of their email.
 */
export function describeActivityEvent(event, selfEmail = '') {
    const detail = parseDetail(event.detail);
    const actorEmail = (event.actorEmail || '').toLowerCase();
    const actor = actorEmail && actorEmail === selfEmail ? 'You' : (event.actorEmail || 'Someone');
    const subjectEmail = (event.subject || '').toLowerCase();
    const member = subjectEmail && subjectEmail === selfEmail ? 'you' : (event.subject || 'a member');
    const name = detail.name || event.subject || 'a collection';

    switch (event.action) {
        case 'collection_added':
            return `${actor} added “${name}”`;
        case 'collection_updated':
            return `${actor} updated “${name}”`;
        case 'collection_deleted':
            return `${actor} deleted “${name}”`;
        case 'folder_renamed':
            return detail.from && detail.to
                ? `${actor} renamed the folder from “${detail.from}” to “${detail.to}”`
                : `${actor} renamed the folder`;
        case 'member_joined':
            return `${actor} joined${detail.role ? ` as ${detail.role}` : ''}`;
        case 'member_left':
            return `${actor} left the folder`;
        case 'member_removed':
            return `${actor} removed ${member}`;
        case 'role_changed':
            return `${actor} changed ${member === 'you' ? 'your' : `${member}'s`} role${detail.role ? ` to ${detail.role}` : ''}`;
        default:
            return `${actor} updated the folder`;
    }
}

/**
 * Right-side "Activity & comments" panel for shared folders (full-page only).
 * Mirrors the fp-detail-panel width-transition pattern but fixed ~380px.
 * Renders nothing when no shared folder is provided.
 */
function FPSharedPanel({ folder, collections, isOpen, onClose }) {
    const isPro = useAtomValue(isProState);
    const selectedCollectionUid = useAtomValue(selectedCollectionUidState);

    const folderUid = folder?.uid || null;
    const isFolderOwner = folder?.shared?.role === 'owner';

    const [tab, setTab] = useState('activity');
    const [selfEmail, setSelfEmail] = useState('');
    const [activity, setActivity] = useState({ loading: false, error: false, events: [] });
    const [comments, setComments] = useState({ loading: false, error: false, comments: [], counts: [] });
    // null = folder-level "Folder discussion" thread, otherwise a collection uid.
    const [activeThread, setActiveThread] = useState(null);
    const [body, setBody] = useState('');
    const [posting, setPosting] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const folderCollections = useMemo(
        () => (collections || []).filter((collection) => collection.parentId === folderUid),
        [collections, folderUid],
    );

    useEffect(() => {
        let live = true;
        browser.storage.local.get('googleUser')
            .then((stored) => {
                if (live) setSelfEmail((stored?.googleUser?.emailAddress || '').toLowerCase());
            })
            .catch(() => {});
        return () => { live = false; };
    }, []);

    // Reset per-folder state when the target folder changes.
    useEffect(() => {
        setActiveThread(null);
        setBody('');
        setConfirmDeleteId(null);
        setActivity({ loading: false, error: false, events: [] });
        setComments({ loading: false, error: false, comments: [], counts: [] });
    }, [folderUid]);

    const fetchActivity = useCallback(async () => {
        if (!folderUid) return;
        setActivity((previous) => ({ ...previous, loading: previous.events.length === 0, error: false }));
        try {
            const res = await browser.runtime.sendMessage({ type: 'sharedGetActivity', folderId: folderUid });
            if (res?.ok) {
                setActivity({ loading: false, error: false, events: res.data?.events || [] });
                await markActivitySeen(folderUid);
            } else {
                setActivity((previous) => ({ ...previous, loading: false, error: true }));
            }
        } catch {
            setActivity((previous) => ({ ...previous, loading: false, error: true }));
        }
    }, [folderUid]);

    const fetchComments = useCallback(async () => {
        if (!folderUid) return;
        setComments((previous) => ({ ...previous, loading: previous.comments.length === 0, error: false }));
        try {
            const res = await browser.runtime.sendMessage({
                type: 'sharedGetComments',
                folderId: folderUid,
                ...(activeThread ? { collectionUid: activeThread } : {}),
            });
            if (res?.ok) {
                setComments({
                    loading: false,
                    error: false,
                    comments: res.data?.comments || [],
                    counts: res.data?.counts || [],
                });
            } else {
                setComments((previous) => ({ ...previous, loading: false, error: true }));
            }
        } catch {
            setComments((previous) => ({ ...previous, loading: false, error: true }));
        }
    }, [folderUid, activeThread]);

    // Fetch on open / tab switch / thread switch.
    useEffect(() => {
        if (!isOpen || !folderUid) return;
        if (tab === 'activity') {
            fetchActivity();
        } else {
            fetchComments();
        }
    }, [isOpen, folderUid, tab, fetchActivity, fetchComments]);

    // Opening the Activity tab marks the feed as seen (clears the unread dot)
    // even if the network fetch fails.
    useEffect(() => {
        if (isOpen && folderUid && tab === 'activity') {
            markActivitySeen(folderUid);
        }
    }, [isOpen, folderUid, tab]);

    // Light polling while the panel is open; cleaned up on close/unmount.
    useEffect(() => {
        if (!isOpen || !folderUid) return undefined;
        const intervalId = setInterval(() => {
            if (tab === 'activity') {
                fetchActivity();
            } else {
                fetchComments();
            }
        }, POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isOpen, folderUid, tab, fetchActivity, fetchComments]);

    // Selecting a collection in the content area while the panel is open
    // scopes the Comments tab to that collection's thread.
    useEffect(() => {
        if (!isOpen || !selectedCollectionUid) return;
        if (folderCollections.some((collection) => collection.uid === selectedCollectionUid)) {
            setActiveThread(selectedCollectionUid);
        }
    }, [isOpen, selectedCollectionUid, folderCollections]);

    const handlePost = useCallback(async () => {
        const trimmed = body.trim();
        if (!trimmed || posting || !folderUid) return;
        setPosting(true);
        try {
            const res = await browser.runtime.sendMessage({
                type: 'sharedPostComment',
                folderId: folderUid,
                ...(activeThread ? { collectionUid: activeThread } : {}),
                body: trimmed,
            });
            if (res?.ok) {
                setBody('');
                await fetchComments();
            } else if (res?.error === 'pro_required') {
                showErrorToast('Posting comments requires Tabox Pro.');
            } else {
                showErrorToast('Could not post your comment. Please try again.');
            }
        } catch {
            showErrorToast('Could not post your comment. Please try again.');
        } finally {
            setPosting(false);
        }
    }, [body, posting, folderUid, activeThread, fetchComments]);

    const handleDelete = useCallback(async (commentId) => {
        if (!folderUid) return;
        setConfirmDeleteId(null);
        try {
            const res = await browser.runtime.sendMessage({
                type: 'sharedDeleteComment',
                folderId: folderUid,
                commentId,
            });
            if (res?.ok) {
                await fetchComments();
            } else {
                showErrorToast('Could not delete the comment.');
            }
        } catch {
            showErrorToast('Could not delete the comment.');
        }
    }, [folderUid, fetchComments]);

    const handleUpgrade = useCallback(async () => {
        try {
            const ok = await browser.runtime.sendMessage({ type: 'openProCheckout' });
            if (!ok) {
                const loggedIn = await browser.runtime.sendMessage({ type: 'login' });
                if (loggedIn) await browser.runtime.sendMessage({ type: 'openProCheckout' });
            }
        } catch {
            showErrorToast('Could not open the upgrade page.');
        }
    }, []);

    const groupedActivity = useMemo(() => {
        const groups = [];
        let current = null;
        (activity.events || []).forEach((event) => {
            const label = formatDayLabel(event.createdAt);
            if (!current || current.label !== label) {
                current = { label, events: [] };
                groups.push(current);
            }
            current.events.push(event);
        });
        return groups;
    }, [activity.events]);

    const countForThread = useCallback((collectionUid) => {
        const entry = (comments.counts || []).find(
            (count) => (count.collectionUid || null) === (collectionUid || null),
        );
        return entry?.n || 0;
    }, [comments.counts]);

    if (!folder) return null;

    const canDeleteComment = (comment) => (
        isFolderOwner || (comment.authorEmail || '').toLowerCase() === selfEmail
    );

    return (
        <aside
            className={`fp-shared-panel ${isOpen ? 'open' : ''}`}
            aria-hidden={!isOpen}
            aria-label="Activity and comments"
        >
            <div className="fp-shared-panel-inner">
                <div className="fp-shared-panel-header">
                    <div className="fp-shared-panel-heading">
                        <h3 className="fp-shared-panel-title">Activity &amp; comments</h3>
                        <span className="fp-shared-panel-folder-name">{folder.name}</span>
                    </div>
                    <button
                        className="fp-shared-panel-close"
                        onClick={onClose}
                        aria-label="Close activity and comments"
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content="Close panel"
                    >
                        <MdClose size={18} />
                    </button>
                </div>

                <div className="fp-shared-panel-tabs" role="tablist" aria-label="Panel sections">
                    <button
                        role="tab"
                        aria-selected={tab === 'activity'}
                        className={`fp-shared-panel-tab ${tab === 'activity' ? 'active' : ''}`}
                        onClick={() => setTab('activity')}
                    >
                        Activity
                    </button>
                    <button
                        role="tab"
                        aria-selected={tab === 'comments'}
                        className={`fp-shared-panel-tab ${tab === 'comments' ? 'active' : ''}`}
                        onClick={() => setTab('comments')}
                    >
                        Comments
                    </button>
                </div>

                {tab === 'activity' && (
                    <div className="fp-shared-panel-body" role="tabpanel" aria-label="Activity">
                        {activity.loading && (
                            <div className="fp-shared-panel-status">Loading activity…</div>
                        )}
                        {!activity.loading && activity.error && (
                            <div className="fp-shared-panel-status fp-shared-panel-error">
                                <span>Couldn’t load activity.</span>
                                <button className="fp-shared-panel-retry" onClick={fetchActivity}>Retry</button>
                            </div>
                        )}
                        {!activity.loading && !activity.error && activity.events.length === 0 && (
                            <div className="fp-shared-panel-status">No activity yet.</div>
                        )}
                        {!activity.loading && !activity.error && groupedActivity.map((group) => (
                            <div className="fp-shared-activity-group" key={group.label}>
                                <div className="fp-shared-activity-day">{group.label}</div>
                                <ul className="fp-shared-activity-list">
                                    {group.events.map((event) => (
                                        <li className="fp-shared-activity-entry" key={event.id}>
                                            <span className="fp-shared-activity-text">
                                                {describeActivityEvent(event, selfEmail)}
                                            </span>
                                            <span className="fp-shared-activity-time">
                                                {formatRelativeTime(event.createdAt)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}

                {tab === 'comments' && (
                    <div className="fp-shared-panel-body fp-shared-comments-body" role="tabpanel" aria-label="Comments">
                        <select
                            className="fp-shared-thread-select"
                            aria-label="Comment thread"
                            value={activeThread || ''}
                            onChange={(e) => setActiveThread(e.target.value || null)}
                        >
                            <option value="">{`Folder discussion (${countForThread(null)})`}</option>
                            {folderCollections.map((collection) => (
                                <option key={collection.uid} value={collection.uid}>
                                    {`${collection.name} (${countForThread(collection.uid)})`}
                                </option>
                            ))}
                        </select>

                        <div className="fp-shared-comments-list">
                            {comments.loading && (
                                <div className="fp-shared-panel-status">Loading comments…</div>
                            )}
                            {!comments.loading && comments.error && (
                                <div className="fp-shared-panel-status fp-shared-panel-error">
                                    <span>Couldn’t load comments.</span>
                                    <button className="fp-shared-panel-retry" onClick={fetchComments}>Retry</button>
                                </div>
                            )}
                            {!comments.loading && !comments.error && comments.comments.length === 0 && (
                                <div className="fp-shared-panel-status">
                                    No comments yet — start the discussion.
                                </div>
                            )}
                            {!comments.loading && !comments.error && comments.comments.map((comment) => (
                                <div className="fp-shared-comment" key={comment.id}>
                                    <div className="fp-shared-comment-meta">
                                        <span className="fp-shared-comment-author">
                                            {(comment.authorEmail || '').toLowerCase() === selfEmail
                                                ? 'You'
                                                : comment.authorEmail}
                                        </span>
                                        <span className="fp-shared-comment-time">
                                            {formatRelativeTime(comment.createdAt)}
                                        </span>
                                        {canDeleteComment(comment) && confirmDeleteId !== comment.id && (
                                            <button
                                                className="fp-shared-comment-delete"
                                                onClick={() => setConfirmDeleteId(comment.id)}
                                                aria-label="Delete comment"
                                                data-tooltip-id="main-tooltip"
                                                data-tooltip-content="Delete comment"
                                            >
                                                <MdDeleteOutline size={15} />
                                            </button>
                                        )}
                                        {confirmDeleteId === comment.id && (
                                            <span className="fp-shared-comment-confirm">
                                                <button
                                                    className="fp-shared-comment-confirm-yes"
                                                    onClick={() => handleDelete(comment.id)}
                                                >
                                                    Delete?
                                                </button>
                                                <button
                                                    className="fp-shared-comment-confirm-no"
                                                    onClick={() => setConfirmDeleteId(null)}
                                                >
                                                    Cancel
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                    <div className="fp-shared-comment-body">{comment.body}</div>
                                </div>
                            ))}
                        </div>

                        <div className={`fp-shared-composer ${isPro ? '' : 'fp-shared-composer-locked'}`}>
                            <textarea
                                className="fp-shared-composer-input"
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handlePost();
                                    }
                                }}
                                placeholder={isPro ? 'Write a comment…' : 'Posting comments requires Tabox Pro'}
                                aria-label="Write a comment"
                                disabled={!isPro || posting}
                                rows={2}
                            />
                            {isPro ? (
                                <button
                                    className="fp-shared-composer-send"
                                    onClick={handlePost}
                                    disabled={!body.trim() || posting}
                                    aria-label="Send comment"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Send comment (Enter)"
                                >
                                    <MdSend size={17} />
                                </button>
                            ) : (
                                <div className="fp-shared-composer-upsell">
                                    <ProBadge />
                                    <button className="fp-shared-upgrade-btn" onClick={handleUpgrade}>
                                        Upgrade to post comments
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
}

export default FPSharedPanel;
