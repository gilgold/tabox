import React, { useEffect, useMemo, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue } from 'jotai';
import {
    MdAutorenew,
    MdCheck,
    MdClear,
    MdClose,
    MdFolderShared,
    MdLink,
    MdPerson,
    MdPersonAdd,
    MdSearch,
} from 'react-icons/md';
import { browser } from '../static/globals';
import { shareFolderModalState } from './atoms/sharedFoldersState';
import { isProState } from './atoms/premiumState';
import { saveContact, searchContacts } from './utils/contactsUtils';
import { gatherCollectionsForShare } from './utils/sharedFolderActions';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { ensureNotificationsPermission } from './utils/notificationsPermission';
import ShareProPaywall from './ShareProPaywall';
import './Modal.css';
import './ShareFolderModal.css';

const ERROR_TEXT = {
    member_limit: 'This folder already has the maximum of 20 members.',
    cannot_invite_self: "You can't invite yourself.",
    invalid_email: 'That email address doesn’t look valid.',
    not_signed_in: 'Sign in with Google (Settings → Sync) to share folders.',
    pro_required: 'Sharing folders requires Tabox Pro.',
    rate_limited: 'Too many requests — please wait a minute and try again.',
};
const STATUS_LABEL = { invited: 'Pending', active: 'Active', declined: 'Declined' };

export default function ShareFolderModal() {
    const [folder, setFolder] = useAtom(shareFolderModalState);
    const isPro = useAtomValue(isProState);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('read');
    const [saveAsContact, setSaveAsContact] = useState(false);
    const [contactName, setContactName] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [members, setMembers] = useState(folder?.shared?.members || []);
    const [memberSearch, setMemberSearch] = useState('');
    const [selectedEmails, setSelectedEmails] = useState([]);
    const [batchRole, setBatchRole] = useState('read');
    const [busyAction, setBusyAction] = useState(null);
    const [link, setLink] = useState(null); // { token, role, url } | null
    const [linkLoaded, setLinkLoaded] = useState(false);
    const [linkBusy, setLinkBusy] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);

    useEffect(() => {
        setMembers(folder?.shared?.members || []);
        setEmail('');
        setMemberSearch('');
        setSelectedEmails([]);
        setBatchRole('read');
    }, [folder]);
    useEffect(() => {
        let live = true;
        setLink(null);
        setLinkCopied(false);
        setLinkLoaded(false);
        const folderIsShared = Boolean(folder?.shared?.folderId);
        const folderIsOwned = !folder?.shared || folder?.shared?.role === 'owner';
        if (folder && isPro && folderIsShared && folderIsOwned) {
            browser.runtime.sendMessage({ type: 'sharedGetFolderLink', folderId: folder.uid })
                .then((res) => {
                    if (!live) return;
                    if (res?.ok) setLink(res.data.link || null);
                    setLinkLoaded(true);
                })
                .catch(() => live && setLinkLoaded(true));
        } else {
            // Unshared folders have no server record yet — the create flow
            // shares first, so the CTA can show without a lookup.
            setLinkLoaded(true);
        }
        return () => { live = false; };
    }, [folder, isPro]);
    useEffect(() => {
        let live = true;
        // Local member cache can be stale — refresh statuses from the server when the owner opens the modal
        if (folder?.shared?.role === 'owner') {
            browser.runtime.sendMessage({ type: 'sharedGetMembers', folderId: folder.uid })
                .then((res) => { if (live && res?.ok) setMembers(res.data.members || []); })
                .catch(() => {});
        }
        return () => { live = false; };
    }, [folder]);
    useEffect(() => {
        let live = true;
        searchContacts(email).then((m) => live && setSuggestions(m.slice(0, 5)));
        return () => { live = false; };
    }, [email]);

    const normalizedMemberSearch = memberSearch.trim().toLowerCase();
    const filteredMembers = useMemo(() => {
        if (!normalizedMemberSearch) return members;
        return members.filter((member) => (
            member.email.toLowerCase().includes(normalizedMemberSearch)
            || (member.firstName || '').toLowerCase().includes(normalizedMemberSearch)
        ));
    }, [members, normalizedMemberSearch]);
    const selectedEmailSet = useMemo(() => new Set(selectedEmails), [selectedEmails]);
    const selectableFilteredMembers = useMemo(
        () => filteredMembers.filter((member) => member.status !== 'declined'),
        [filteredMembers]
    );
    if (!folder) return null;
    const busy = Boolean(busyAction);
    const close = () => !busy && setFolder(null);
    const isShared = Boolean(folder.shared?.folderId);
    const isOwner = !folder.shared || folder.shared.role === 'owner';
    const showMemberManagement = isOwner && (isShared || members.length > 0);
    const selectedMembers = members.filter((member) => member.status !== 'declined' && selectedEmailSet.has(member.email));
    const allFilteredSelected = selectableFilteredMembers.length > 0
        && selectableFilteredMembers.every((member) => selectedEmailSet.has(member.email));
    const memberCountLabel = normalizedMemberSearch
        ? `${filteredMembers.length} of ${members.length} ${members.length === 1 ? 'person' : 'people'}`
        : `${members.length} ${members.length === 1 ? 'person' : 'people'}`;

    const send = async (msg) => browser.runtime.sendMessage(msg);

    const toggleMemberSelection = (memberEmail) => {
        setSelectedEmails((current) => current.includes(memberEmail)
            ? current.filter((emailAddress) => emailAddress !== memberEmail)
            : [...current, memberEmail]);
    };

    const selectAllFilteredMembers = () => {
        setSelectedEmails((current) => {
            const next = new Set(current);
            selectableFilteredMembers.forEach((member) => next.add(member.email));
            return [...next];
        });
    };

    const clearMemberSelection = () => setSelectedEmails([]);

    // Order-consistency: the payload carries the sharer's current display
    // order as explicit `order` values (also persisted locally) — see
    // gatherCollectionsForShare for why members diverge without it.
    const gatherCollections = async () => gatherCollectionsForShare(folder.uid);

    const handleShare = async () => {
        const target = email.trim().toLowerCase();
        if (!target) return;
        // Sharing is the user's first shared-folder interaction — ask for the
        // optional notifications permission (fire-and-forget; never blocks).
        ensureNotificationsPermission();
        setBusyAction({ type: 'share' });
        try {
            let res;
            if (!isShared) {
                const collections = await gatherCollections();
                res = await send({
                    type: 'sharedCreateShare',
                    folder: { uid: folder.uid, name: folder.name, color: folder.color },
                    collections,
                    invites: [{ email: target, role }],
                });
            } else {
                res = await send({ type: 'sharedInvite', folderId: folder.uid, email: target, role });
            }
            if (res?.ok) {
                if (saveAsContact) await saveContact({ name: contactName, email: target });
                setMembers(res.data.members || members);
                setEmail('');
                setContactName('');
                setSaveAsContact(false);
                showSuccessToast(`Invite sent to ${target}`);
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not send the invite. Please try again.');
            }
        } finally {
            setBusyAction(null);
        }
    };

    const handleRoleChange = async (memberEmail, newRole) => {
        setBusyAction({ type: 'role', email: memberEmail });
        try {
            const res = await send({ type: 'sharedUpdateMemberRole', folderId: folder.uid, email: memberEmail, role: newRole });
            if (res?.ok) {
                setMembers((m) => m.map((x) => (x.email === memberEmail ? { ...x, role: newRole } : x)));
                showSuccessToast(`Permission updated: ${memberEmail} can now ${newRole === 'write' ? 'edit' : 'view'} this folder.`);
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || `Couldn’t update permission for ${memberEmail}. Please try again.`);
            }
        } catch {
            showErrorToast(`Couldn’t update permission for ${memberEmail}. Please try again.`);
        } finally {
            setBusyAction(null);
        }
    };
    const handleRevoke = async (memberEmail) => {
        setBusyAction({ type: 'revoke', email: memberEmail });
        try {
            const res = await send({ type: 'sharedRemoveMember', folderId: folder.uid, email: memberEmail });
            if (res?.ok) {
                setMembers((m) => m.filter((x) => x.email !== memberEmail));
                setSelectedEmails((current) => current.filter((emailAddress) => emailAddress !== memberEmail));
                showSuccessToast(`Removed ${memberEmail}`);
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not remove this member.');
            }
        } finally {
            setBusyAction(null);
        }
    };

    const handleBatchRoleChange = async () => {
        const targets = selectedMembers;
        if (targets.length === 0) return;
        const succeeded = [];
        const failed = [];
        setBusyAction({ type: 'batch-role', current: 1, total: targets.length });
        try {
            for (let index = 0; index < targets.length; index += 1) {
                const member = targets[index];
                setBusyAction({ type: 'batch-role', current: index + 1, total: targets.length });
                try {
                    const res = await send({
                        type: 'sharedUpdateMemberRole',
                        folderId: folder.uid,
                        email: member.email,
                        role: batchRole,
                    });
                    (res?.ok ? succeeded : failed).push(member.email);
                } catch {
                    failed.push(member.email);
                }
            }

            if (succeeded.length > 0) {
                const succeededSet = new Set(succeeded);
                setMembers((current) => current.map((member) => succeededSet.has(member.email)
                    ? { ...member, role: batchRole }
                    : member));
            }
            setSelectedEmails(failed);

            if (failed.length === 0) {
                showSuccessToast(`Updated access for ${succeeded.length} ${succeeded.length === 1 ? 'person' : 'people'} — they can now ${batchRole === 'write' ? 'edit' : 'view'} this folder.`);
            } else if (succeeded.length > 0) {
                showErrorToast(`Updated ${succeeded.length} of ${targets.length} people. Couldn’t update ${failed.length}.`);
            } else {
                showErrorToast(`Couldn’t update access for ${failed.length} ${failed.length === 1 ? 'person' : 'people'}. Please try again.`);
            }
        } finally {
            setBusyAction(null);
        }
    };

    const handleBatchRevoke = async () => {
        const targets = selectedMembers;
        if (targets.length === 0) return;
        const succeeded = [];
        const failed = [];
        setBusyAction({ type: 'batch-revoke', current: 1, total: targets.length });
        try {
            for (let index = 0; index < targets.length; index += 1) {
                const member = targets[index];
                setBusyAction({ type: 'batch-revoke', current: index + 1, total: targets.length });
                try {
                    const res = await send({ type: 'sharedRemoveMember', folderId: folder.uid, email: member.email });
                    (res?.ok ? succeeded : failed).push(member.email);
                } catch {
                    failed.push(member.email);
                }
            }

            if (succeeded.length > 0) {
                const succeededSet = new Set(succeeded);
                setMembers((current) => current.filter((member) => !succeededSet.has(member.email)));
            }
            setSelectedEmails(failed);

            if (failed.length === 0) {
                showSuccessToast(`Revoked access for ${succeeded.length} ${succeeded.length === 1 ? 'person' : 'people'}.`);
            } else if (succeeded.length > 0) {
                showErrorToast(`Revoked access for ${succeeded.length} of ${targets.length} people. Couldn’t revoke ${failed.length}.`);
            } else {
                showErrorToast(`Couldn’t revoke access for ${failed.length} ${failed.length === 1 ? 'person' : 'people'}. Please try again.`);
            }
        } finally {
            setBusyAction(null);
        }
    };
    const handleCreateOrUpdateLink = async (linkRole, rotate = false) => {
        // Creating a join link shares the folder — same optional-permission
        // moment as an email invite (fire-and-forget; never blocks).
        ensureNotificationsPermission();
        setLinkBusy(true);
        try {
            if (!isShared) {
                // A link needs the folder's server-side record — creating one
                // shares the folder first (no invites; the link is the invite).
                const collections = await gatherCollections();
                const created = await send({
                    type: 'sharedCreateShare',
                    folder: { uid: folder.uid, name: folder.name, color: folder.color },
                    collections,
                    invites: [],
                });
                if (!created?.ok) {
                    showErrorToast(ERROR_TEXT[created?.error] || 'Could not share this folder. Please try again.');
                    return;
                }
            }
            const res = await send({
                type: 'sharedCreateFolderLink',
                folderId: folder.uid,
                role: linkRole,
                ...(rotate ? { rotate: true } : {}),
            });
            if (res?.ok) {
                setLink(res.data);
                setLinkCopied(false);
                // A link role change re-grades everyone who joined via the
                // link server-side; mirror the new roles in the member list.
                const regraded = res.data.updatedMembers;
                if (regraded?.length) {
                    const newRoles = new Map(regraded.map((u) => [u.email, u.role]));
                    setMembers((m) => m.map((x) => (newRoles.has(x.email) ? { ...x, role: newRoles.get(x.email) } : x)));
                }
                if (rotate) {
                    showSuccessToast('New link created — the old one no longer works.');
                } else if (regraded?.length) {
                    showSuccessToast(`Link updated — access changed for ${regraded.length} ${regraded.length === 1 ? 'person' : 'people'} who joined via this link.`);
                } else {
                    showSuccessToast('Share link ready.');
                }
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not create the link. Please try again.');
            }
        } finally {
            setLinkBusy(false);
        }
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(link.url);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        } catch {
            showErrorToast('Couldn\'t copy — select the link text and copy manually.');
        }
    };

    const handleRemoveLink = async () => {
        setLinkBusy(true);
        try {
            const res = await send({ type: 'sharedDeleteFolderLink', folderId: folder.uid });
            if (res?.ok) {
                setLink(null);
                showSuccessToast('Link removed — it can no longer be used to join.');
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not remove the link.');
            }
        } finally {
            setLinkBusy(false);
        }
    };

    const handleReinvite = async (member) => {
        setBusyAction({ type: 'reinvite', email: member.email });
        try {
            const res = await send({ type: 'sharedInvite', folderId: folder.uid, email: member.email, role: member.role });
            if (res?.ok) {
                setMembers(res.data.members || members);
                showSuccessToast(`Invite re-sent to ${member.email}`);
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not send the invite.');
            }
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <Modal
            isOpen
            onRequestClose={close}
            contentLabel={`${isShared ? 'Manage sharing' : 'Share folder'} for ${folder.name}`}
            ariaHideApp={false}
            className={`modal-content share-folder-modal${!isPro ? ' share-modal--upsell' : ''}`}
            overlayClassName="modal-overlay"
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="share-modal-header">
                <div className="share-modal-header-icon" aria-hidden="true">
                    <MdFolderShared size={22} />
                </div>
                <div className="share-modal-heading">
                    <h3>{isShared ? 'Manage sharing' : 'Share folder'}</h3>
                    <p>{folder.name}</p>
                </div>
                <button className="share-modal-close" onClick={close} aria-label="Close" type="button" disabled={busy}>
                    <MdClose size={19} />
                </button>
            </div>
            {!isPro ? (
                <ShareProPaywall />
            ) : (
                <div className="share-modal-body">
                    <section className="share-invite-section" aria-labelledby="share-invite-title">
                        <div className="share-section-heading">
                            <div>
                                <h4 id="share-invite-title">Invite people</h4>
                                <p>Add someone using the Google email they use with Tabox.</p>
                            </div>
                        </div>
                        <div className="share-invite-row">
                            <div className="share-email-wrap">
                                <MdPersonAdd className="share-field-icon" size={18} aria-hidden="true" />
                                <input
                                    type="email"
                                    placeholder="Email address"
                                    value={email}
                                    disabled={busy}
                                    onChange={(e) => setEmail(e.target.value)}
                                    aria-label="Email address"
                                />
                                {suggestions.length > 0 && email && !suggestions.some((s) => s.email === email.toLowerCase()) && (
                                    <ul className="share-suggestions" role="listbox">
                                        {suggestions.map((s) => (
                                            <li key={s.email} role="option" aria-selected="false" onMouseDown={() => setEmail(s.email)}>
                                                <span className="share-suggestion-avatar" aria-hidden="true">{s.name?.charAt(0) || s.email.charAt(0)}</span>
                                                <span className="share-suggestion-copy">
                                                    <span className="share-suggestion-name">{s.name}</span>
                                                    <span className="share-suggestion-email">{s.email}</span>
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Permission" disabled={busy}>
                                <option value="read">Can view</option>
                                <option value="write">Can edit</option>
                            </select>
                            <button className="share-submit" onClick={handleShare} disabled={busy || !email.trim()} type="button">
                                {busyAction?.type === 'share' ? 'Sharing…' : 'Share'}
                            </button>
                        </div>
                        <div className="share-invite-options">
                            <label className="share-save-contact">
                                <input type="checkbox" checked={saveAsContact} onChange={(e) => setSaveAsContact(e.target.checked)} disabled={busy} />
                                <span className="share-checkbox" aria-hidden="true"><MdCheck size={13} /></span>
                                Save to contacts
                            </label>
                            <span className="share-hint">They’ll receive a pending invitation.</span>
                        </div>
                        {saveAsContact && (
                            <input
                                className="share-contact-name"
                                placeholder="Contact name (optional)"
                                value={contactName}
                                onChange={(e) => setContactName(e.target.value)}
                                aria-label="Contact name"
                                disabled={busy}
                            />
                        )}
                    </section>

                    {isOwner && (
                        <section className="share-link-section" aria-labelledby="share-link-title">
                            <div className="share-section-heading">
                                <div>
                                    <h4 id="share-link-title">Share with link</h4>
                                    <p>Anyone with the link can join this folder instantly.</p>
                                </div>
                            </div>
                            {!linkLoaded ? null : link ? (
                                <>
                                    <div className="share-link-row">
                                        <MdLink className="share-field-icon" size={18} aria-hidden="true" />
                                        <input type="text" readOnly value={link.url} aria-label="Share link" onFocus={(e) => e.target.select()} />
                                        <button
                                            className="share-link-copy"
                                            type="button"
                                            onClick={handleCopyLink}
                                            disabled={busy || linkBusy}
                                            data-tooltip-id="main-tooltip"
                                            data-tooltip-content="Copy link to clipboard"
                                        >
                                            {linkCopied ? 'Copied ✓' : 'Copy'}
                                        </button>
                                    </div>
                                    <div className="share-link-controls">
                                        <select
                                            value={link.role}
                                            onChange={(e) => handleCreateOrUpdateLink(e.target.value)}
                                            aria-label="Permission for people joining via link"
                                            disabled={busy || linkBusy}
                                        >
                                            <option value="read">Joiners can view</option>
                                            <option value="write">Joiners can edit</option>
                                        </select>
                                        <button
                                            type="button"
                                            className="share-link-rotate"
                                            onClick={() => handleCreateOrUpdateLink(link.role, true)}
                                            disabled={busy || linkBusy}
                                            data-tooltip-id="main-tooltip"
                                            data-tooltip-content="Replace with a new link — the current one stops working"
                                        >
                                            New link
                                        </button>
                                        <button
                                            type="button"
                                            className="share-link-remove"
                                            onClick={handleRemoveLink}
                                            disabled={busy || linkBusy}
                                            data-tooltip-id="main-tooltip"
                                            data-tooltip-content="Delete the link — nobody new can join with it"
                                        >
                                            Remove link
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <button
                                    className="share-link-create"
                                    type="button"
                                    onClick={() => handleCreateOrUpdateLink('read')}
                                    disabled={busy || linkBusy}
                                >
                                    {linkBusy ? 'Creating…' : 'Create link'}
                                </button>
                            )}
                        </section>
                    )}

                    {showMemberManagement && (
                        <section className="share-members" aria-labelledby="share-members-title">
                            <div className="share-members-heading">
                                <div>
                                    <h4 id="share-members-title">People with access</h4>
                                    <span className="share-member-count">{memberCountLabel}</span>
                                </div>
                                {members.length > 0 && (
                                    <div className="share-member-search">
                                        <MdSearch size={17} aria-hidden="true" />
                                        <input
                                            type="search"
                                            value={memberSearch}
                                            onChange={(e) => setMemberSearch(e.target.value)}
                                            placeholder="Search people"
                                            aria-label="Search people with access"
                                        />
                                        {memberSearch && (
                                            <button type="button" onClick={() => setMemberSearch('')} aria-label="Clear people search">
                                                <MdClear size={16} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            {members.some((member) => member.status !== 'declined') && (
                                <div className={`share-batch-toolbar${selectedEmails.length > 0 ? ' has-selection' : ''}`}>
                                    <div className="share-selection-controls">
                                        <button
                                            type="button"
                                            onClick={selectAllFilteredMembers}
                                            disabled={busy || selectableFilteredMembers.length === 0 || allFilteredSelected}
                                        >
                                            Select all
                                        </button>
                                        <span className="share-selection-divider" aria-hidden="true" />
                                        <button
                                            type="button"
                                            onClick={clearMemberSelection}
                                            disabled={busy || selectedEmails.length === 0}
                                        >
                                            Select none
                                        </button>
                                        {selectedEmails.length > 0 && (
                                            <span className="share-selection-count">{selectedEmails.length} selected</span>
                                        )}
                                    </div>
                                    {selectedEmails.length > 0 && (
                                        <div className="share-batch-actions">
                                            {busyAction?.type === 'batch-role' || busyAction?.type === 'batch-revoke' ? (
                                                <span
                                                    className="share-batch-progress"
                                                    role="status"
                                                    aria-live="polite"
                                                    aria-label={`${busyAction.type === 'batch-role' ? 'Updating' : 'Revoking'} access for ${busyAction.total} people`}
                                                >
                                                    <MdAutorenew size={16} aria-hidden="true" />
                                                    {busyAction.type === 'batch-role' ? 'Updating' : 'Revoking'} {busyAction.current} of {busyAction.total}…
                                                </span>
                                            ) : (
                                                <>
                                                    <select
                                                        value={batchRole}
                                                        onChange={(e) => setBatchRole(e.target.value)}
                                                        aria-label="Access for selected people"
                                                        disabled={busy}
                                                    >
                                                        <option value="read">Can view</option>
                                                        <option value="write">Can edit</option>
                                                    </select>
                                                    <button
                                                        className="share-batch-update"
                                                        type="button"
                                                        onClick={handleBatchRoleChange}
                                                        disabled={busy}
                                                    >
                                                        Update access
                                                    </button>
                                                    <button
                                                        className="share-batch-revoke"
                                                        type="button"
                                                        onClick={handleBatchRevoke}
                                                        disabled={busy}
                                                    >
                                                        Revoke access
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="share-member-list">
                                {filteredMembers.length === 0 ? (
                                    <div className="share-members-empty">
                                        <MdPerson size={24} aria-hidden="true" />
                                        <p>{normalizedMemberSearch ? `No people match “${memberSearch.trim()}”.` : 'No one else has access yet.'}</p>
                                        <span>{normalizedMemberSearch ? 'Try a different email.' : 'Invite someone above to start sharing.'}</span>
                                    </div>
                                ) : filteredMembers.map((m) => (
                                    <div key={m.email} className={`share-member-row${selectedEmailSet.has(m.email) ? ' is-selected' : ''}`}>
                                        <label className="share-member-selector">
                                            <input
                                                type="checkbox"
                                                checked={selectedEmailSet.has(m.email)}
                                                onChange={() => toggleMemberSelection(m.email)}
                                                disabled={busy || m.status === 'declined'}
                                                aria-label={`Select ${m.email}`}
                                            />
                                            <span aria-hidden="true"><MdCheck size={13} /></span>
                                        </label>
                                        <span className="share-member-avatar" aria-hidden="true">{(m.firstName || m.email).charAt(0).toUpperCase()}</span>
                                        <div className="share-member-identity">
                                            {m.firstName && <span className="share-member-name">{m.firstName}</span>}
                                            <span className="share-member-email">{m.email}</span>
                                            <span className={`share-member-status status-${m.status}`}>
                                                <span className="share-member-status-dot" aria-hidden="true" />
                                                {STATUS_LABEL[m.status] || m.status}
                                            </span>
                                        </div>
                                        <div className="share-member-actions">
                                            {m.status !== 'declined' ? (
                                                <select
                                                    value={m.role}
                                                    onChange={(e) => handleRoleChange(m.email, e.target.value)}
                                                    aria-label={`Permission for ${m.email}`}
                                                    disabled={busy}
                                                >
                                                    <option value="read">Can view</option>
                                                    <option value="write">Can edit</option>
                                                </select>
                                            ) : (
                                                <button
                                                    className="share-reinvite"
                                                    onClick={() => handleReinvite(m)}
                                                    disabled={busy}
                                                    data-tooltip-id="main-tooltip"
                                                    data-tooltip-content="Send this person a new invite"
                                                    type="button"
                                                >
                                                    Invite again
                                                </button>
                                            )}
                                            {busyAction?.type === 'role' && busyAction.email === m.email ? (
                                                <span
                                                    className="share-member-role-progress"
                                                    role="status"
                                                    aria-live="polite"
                                                    aria-label={`Updating permission for ${m.email}`}
                                                >
                                                    <MdAutorenew size={15} aria-hidden="true" />
                                                    Updating…
                                                </span>
                                            ) : (
                                                <button
                                                    className="share-revoke"
                                                    onClick={() => handleRevoke(m.email)}
                                                    disabled={busy}
                                                    data-tooltip-id="main-tooltip"
                                                    data-tooltip-content={m.status === 'declined' ? 'Remove from this list' : 'Remove this person’s access'}
                                                    type="button"
                                                >
                                                    {m.status === 'declined' ? 'Remove' : 'Revoke'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </Modal>
    );
}
