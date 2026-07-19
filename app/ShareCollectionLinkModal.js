import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue } from 'jotai';
import { MdClose, MdLink, MdWorkspacePremium } from 'react-icons/md';
import { browser } from '../static/globals';
import { shareCollectionLinkModalState } from './atoms/sharedFoldersState';
import { isProState } from './atoms/premiumState';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import AIUnavailableWarning from './AIUnavailableWarning';
import './Modal.css';
import './ShareCollectionLinkModal.css';

const ERROR_TEXT = {
    not_signed_in: 'Sign in with Google (Settings → Sync) to share collections.',
    pro_required: 'Sharing collections requires Tabox Pro.',
    collection_too_large: 'This collection is too large to share (512 KB max).',
    link_limit: 'You\'ve reached the limit of 100 shared collections. Stop sharing one first.',
    rate_limited: 'Too many requests — please wait a minute and try again.',
};

// Build the snapshot payload: the collection record minus fields that must
// never leave this account (parentId — folder membership is local; lastOpened
// — per-device state).
function toSnapshot(collection) {
    // eslint-disable-next-line no-unused-vars
    const { parentId, lastOpened, ...data } = collection;
    return data;
}

export default function ShareCollectionLinkModal() {
    const [collection, setCollection] = useAtom(shareCollectionLinkModalState);
    const isPro = useAtomValue(isProState);
    const [link, setLink] = useState(null); // { token, url } | null
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let live = true;
        setLink(null);
        setLoaded(false);
        setCopied(false);
        if (collection && isPro) {
            browser.runtime.sendMessage({ type: 'sharedGetCollectionLinks' })
                .then((res) => {
                    if (!live) return;
                    if (res?.ok) {
                        const mine = (res.data.links || []).find((l) => l.uid === collection.uid);
                        if (mine) setLink({ token: mine.token, url: mine.url });
                    }
                    setLoaded(true);
                })
                .catch(() => live && setLoaded(true));
        } else {
            setLoaded(true);
        }
        return () => { live = false; };
    }, [collection, isPro]);

    if (!collection) return null;
    const close = () => !busy && setCollection(null);

    const upload = async (isUpdate) => {
        setBusy(true);
        try {
            const res = await browser.runtime.sendMessage({
                type: 'sharedCreateCollectionLink',
                uid: collection.uid,
                name: collection.name,
                data: toSnapshot(collection),
            });
            if (res?.ok) {
                setLink(res.data);
                setCopied(false);
                showSuccessToast(isUpdate
                    ? 'Link updated with the current tabs.'
                    : 'Share link ready — anyone with it gets a copy of this collection.');
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not create the link. Please try again.');
            }
        } finally {
            setBusy(false);
        }
    };

    const stopSharing = async () => {
        setBusy(true);
        try {
            const res = await browser.runtime.sendMessage({ type: 'sharedDeleteCollectionLink', uid: collection.uid });
            if (res?.ok) {
                setLink(null);
                showSuccessToast('Link removed — it can no longer be opened.');
            } else {
                showErrorToast(ERROR_TEXT[res?.error] || 'Could not remove the link.');
            }
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            showErrorToast('Couldn\'t copy — select the link text and copy manually.');
        }
    };

    return (
        <Modal
            isOpen
            onRequestClose={close}
            contentLabel={`Share ${collection.name} via link`}
            ariaHideApp={false}
            className="modal-content share-collection-link-modal"
            overlayClassName="modal-overlay"
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="share-modal-header">
                <div className="share-modal-header-icon" aria-hidden="true">
                    <MdLink size={22} />
                </div>
                <div className="share-modal-heading">
                    <h3>Share via link</h3>
                    <p>{collection.name}</p>
                </div>
                <button className="share-modal-close" onClick={close} aria-label="Close" type="button" disabled={busy}>
                    <MdClose size={19} />
                </button>
            </div>
            {!isPro ? (
                <div className="share-upgrade">
                    <MdWorkspacePremium size={28} />
                    <p>Sharing collections is a Tabox Pro feature.</p>
                    <AIUnavailableWarning />
                    <button onClick={() => browser.runtime.sendMessage({ type: 'openProCheckout' })}>Upgrade now</button>
                </div>
            ) : (
                <div className="share-collection-link-body">
                    <p className="share-collection-link-hint">
                        Anyone with the link gets a <strong>copy</strong> of this collection — your original stays private,
                        and changes you make later aren&rsquo;t shared until you update the link.
                    </p>
                    {!loaded ? null : link ? (
                        <>
                            <div className="share-link-row">
                                <MdLink className="share-field-icon" size={18} aria-hidden="true" />
                                <input type="text" readOnly value={link.url} aria-label="Share link" onFocus={(e) => e.target.select()} />
                                <button
                                    className="share-link-copy"
                                    type="button"
                                    onClick={copy}
                                    disabled={busy}
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Copy link to clipboard"
                                >
                                    {copied ? 'Copied ✓' : 'Copy'}
                                </button>
                            </div>
                            <div className="share-link-controls">
                                <button
                                    type="button"
                                    className="share-link-rotate"
                                    onClick={() => upload(true)}
                                    disabled={busy}
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Re-upload this collection's current tabs to the same link"
                                >
                                    {busy ? 'Updating…' : 'Update link'}
                                </button>
                                <button
                                    type="button"
                                    className="share-link-remove"
                                    onClick={stopSharing}
                                    disabled={busy}
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content="Delete the link — it stops working for everyone"
                                >
                                    Stop sharing
                                </button>
                            </div>
                        </>
                    ) : (
                        <button className="share-link-create" type="button" onClick={() => upload(false)} disabled={busy}>
                            {busy ? 'Creating…' : 'Create link'}
                        </button>
                    )}
                </div>
            )}
        </Modal>
    );
}
