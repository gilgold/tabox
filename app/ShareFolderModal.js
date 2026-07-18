import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue } from 'jotai';
import { MdClose, MdPersonAdd, MdWorkspacePremium } from 'react-icons/md';
import { browser } from '../static/globals';
import { shareFolderModalState } from './atoms/sharedFoldersState';
import { isProState } from './atoms/premiumState';
import { saveContact, searchContacts } from './utils/contactsUtils';
import { loadCollectionsIndex, loadMultipleCollections } from './utils/storageUtils';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import AIUnavailableWarning from './AIUnavailableWarning';
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
    const [busy, setBusy] = useState(false);

    useEffect(() => { setMembers(folder?.shared?.members || []); setEmail(''); }, [folder]);
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

    if (!folder) return null;
    const close = () => !busy && setFolder(null);
    const isShared = Boolean(folder.shared?.folderId);

    const send = async (msg) => browser.runtime.sendMessage(msg);

    const handleShare = async () => {
        const target = email.trim().toLowerCase();
        if (!target) return;
        setBusy(true);
        try {
            let res;
            if (!isShared) {
                const index = await loadCollectionsIndex();
                const uids = Object.keys(index).filter((uid) => index[uid].parentId === folder.uid);
                const records = await loadMultipleCollections(uids);
                const collections = uids
                    .filter((uid) => records[uid])
                    .map((uid) => {
                        const { parentId, ...data } = records[uid];
                        return { uid, data };
                    });
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
            setBusy(false);
        }
    };

    const handleRoleChange = async (memberEmail, newRole) => {
        setBusy(true);
        try {
            const res = await send({ type: 'sharedUpdateMemberRole', folderId: folder.uid, email: memberEmail, role: newRole });
            if (res?.ok) {
                setMembers((m) => m.map((x) => (x.email === memberEmail ? { ...x, role: newRole } : x)));
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not change the permission.');
            }
        } finally {
            setBusy(false);
        }
    };
    const handleRevoke = async (memberEmail) => {
        setBusy(true);
        try {
            const res = await send({ type: 'sharedRemoveMember', folderId: folder.uid, email: memberEmail });
            if (res?.ok) {
                setMembers((m) => m.filter((x) => x.email !== memberEmail));
                showSuccessToast(`Removed ${memberEmail}`);
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not remove this member.');
            }
        } finally {
            setBusy(false);
        }
    };
    const handleReinvite = async (member) => {
        setBusy(true);
        try {
            const res = await send({ type: 'sharedInvite', folderId: folder.uid, email: member.email, role: member.role });
            if (res?.ok) {
                setMembers(res.data.members || members);
                showSuccessToast(`Invite re-sent to ${member.email}`);
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not send the invite.');
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen
            onRequestClose={close}
            ariaHideApp={false}
            className="modal-content share-folder-modal"
            overlayClassName="modal-overlay"
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="share-modal-header">
                <MdPersonAdd size={20} />
                <h3>Share &ldquo;{folder.name}&rdquo;</h3>
                <button className="share-modal-close" onClick={close} aria-label="Close"><MdClose size={18} /></button>
            </div>
            {!isPro ? (
                <div className="share-upgrade">
                    <MdWorkspacePremium size={28} />
                    <p>Sharing folders is a Tabox Pro feature.</p>
                    <AIUnavailableWarning />
                    <button onClick={() => send({ type: 'openProCheckout' })}>Upgrade now</button>
                </div>
            ) : (
                <>
                    <div className="share-invite-row">
                        <div className="share-email-wrap">
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
                                            <span className="share-suggestion-name">{s.name}</span>
                                            <span className="share-suggestion-email">{s.email}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Permission" disabled={busy}>
                            <option value="read">Can view</option>
                            <option value="write">Can edit</option>
                        </select>
                        <button className="share-submit" onClick={handleShare} disabled={busy || !email.trim()}>Share</button>
                    </div>
                    <label className="share-save-contact">
                        <input type="checkbox" checked={saveAsContact} onChange={(e) => setSaveAsContact(e.target.checked)} />
                        Save as contact
                    </label>
                    {saveAsContact && (
                        <input
                            className="share-contact-name"
                            placeholder="Contact name"
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            aria-label="Contact name"
                        />
                    )}
                    <p className="share-hint">Invitees must sign in to Tabox with this exact Google email.</p>
                    {(!folder.shared || folder.shared.role === 'owner') && members.length > 0 && (
                        <div className="share-members">
                            <h4>People with access</h4>
                            {members.map((m) => (
                                <div key={m.email} className="share-member-row">
                                    <span className="share-member-email">{m.email}</span>
                                    <span className={`share-member-status status-${m.status}`}>{STATUS_LABEL[m.status] || m.status}</span>
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
                                        >
                                            Invite again
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleRevoke(m.email)}
                                        disabled={busy}
                                        data-tooltip-id="main-tooltip"
                                        data-tooltip-content={m.status === 'declined' ? 'Remove from this list' : 'Remove this person’s access'}
                                    >
                                        {m.status === 'declined' ? 'Remove' : 'Revoke'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </Modal>
    );
}
