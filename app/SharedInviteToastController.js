import React, { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import toast from 'react-hot-toast';
import { browser } from '../static/globals';
import { pendingInvitesState, pendingLinkJoinState, sharedActionConfirmState } from './atoms/sharedFoldersState';
import { respondToSharedInvite, joinSharedFolderLink } from './utils/sharedFolderActions';
import SharedInviteToast from './SharedInviteToast';

const toastIdFor = (folderId) => `shared-invite-${folderId}`;
const LINK_JOIN_TOAST_ID = 'shared-link-join';
const SHARED_PENDING_LINK_JOIN_KEY = 'shared_pending_link_join';

// Session-local dismissals (module scope so a controller remount, e.g. a view
// re-render, doesn't instantly re-show a toast the user closed). The invite
// stays pending in storage and will surface again next session.
const dismissedFolderIds = new Set();

/**
 * Stateful host rendered inside toast.custom(). Owns the busy flag for the
 * Accept flow; Decline defers to SharedActionConfirmModal (the toast is
 * dismissed by the controller once the invite leaves pendingInvitesState).
 */
function SharedInviteToastHost({ t, invite, onAccepted, onDecline }) {
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    const ok = await respondToSharedInvite(invite, true, onAccepted);
    if (ok) {
      toast.dismiss(t.id);
    } else {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    dismissedFolderIds.add(invite.folderId);
    toast.dismiss(t.id);
  };

  return (
    <SharedInviteToast
      visible={t.visible}
      invite={invite}
      busy={busy}
      onAccept={handleAccept}
      onDecline={onDecline}
      onDismiss={handleDismiss}
    />
  );
}

/**
 * Toast host for a share-link folder join stashed while the user was signed
 * out (SHARED_PENDING_LINK_JOIN_KEY). Reuses the invite toast card; there is
 * no server-side invite to decline, so Decline and Dismiss both just forget
 * the stash. The background clears the stash on a successful join, which
 * flows back through pendingLinkJoinState and dismisses this toast.
 */
function LinkJoinToastHost({ t, stash, onAccepted }) {
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    const ok = await joinSharedFolderLink(stash, onAccepted);
    if (ok) toast.dismiss(t.id);
    else setBusy(false);
  };

  const handleDismiss = async () => {
    toast.dismiss(t.id);
    try {
      await browser.storage.local.remove(SHARED_PENDING_LINK_JOIN_KEY);
    } catch { /* stash cleanup is best-effort */ }
  };

  return (
    <SharedInviteToast
      visible={t.visible}
      invite={{ folderId: 'link-join', folderName: stash.name, ownerEmail: stash.ownerEmail, role: stash.role }}
      busy={busy}
      onAccept={handleAccept}
      onDecline={handleDismiss}
      onDismiss={handleDismiss}
    />
  );
}

/**
 * Renders nothing; watches pendingInvitesState and drives one persistent
 * bottom-right invite toast per pending invite (popup AND full page).
 * Invite toasts bypass toastHelpers' MAX_TOASTS limit on purpose — they must
 * never be evicted by ordinary success/error toasts.
 */
export default function SharedInviteToastController({ onAccepted }) {
  const invites = useAtomValue(pendingInvitesState);
  const linkJoin = useAtomValue(pendingLinkJoinState);
  const setConfirmState = useSetAtom(sharedActionConfirmState);
  const shownFolderIdsRef = useRef(new Set());
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;

  useEffect(() => {
    const shown = shownFolderIdsRef.current;
    const currentIds = new Set(invites.map((invite) => invite.folderId));

    // Invite disappeared from state (accepted/declined elsewhere — sidebar
    // ghost row, another window) → drop its toast.
    for (const folderId of [...shown]) {
      if (!currentIds.has(folderId)) {
        toast.dismiss(toastIdFor(folderId));
        shown.delete(folderId);
      }
    }

    invites.forEach((invite) => {
      const { folderId } = invite;
      if (shown.has(folderId) || dismissedFolderIds.has(folderId)) return;
      shown.add(folderId);
      toast.custom(
        (t) => (
          <SharedInviteToastHost
            t={t}
            invite={invite}
            onAccepted={() => onAcceptedRef.current?.()}
            onDecline={() => setConfirmState({ kind: 'decline-invite', invite })}
          />
        ),
        {
          id: toastIdFor(folderId),
          duration: Infinity,
          position: 'bottom-right',
        }
      );
    });
  }, [invites, setConfirmState]);

  const linkJoinShownRef = useRef(false);
  useEffect(() => {
    if (!linkJoin) {
      // Only dismiss a toast this controller actually showed — an
      // unconditional dismiss on every empty-stash render would fire spurious
      // toast.dismiss calls on mount.
      if (linkJoinShownRef.current) {
        toast.dismiss(LINK_JOIN_TOAST_ID);
        linkJoinShownRef.current = false;
      }
      return;
    }
    linkJoinShownRef.current = true;
    toast.custom(
      (t) => <LinkJoinToastHost t={t} stash={linkJoin} onAccepted={() => onAcceptedRef.current?.()} />,
      { id: LINK_JOIN_TOAST_ID, duration: Infinity, position: 'bottom-right' }
    );
  }, [linkJoin]);

  return null;
}
