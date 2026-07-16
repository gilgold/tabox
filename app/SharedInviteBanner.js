import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { MdFolderShared } from 'react-icons/md';
import { browser } from '../static/globals';
import { pendingInvitesState } from './atoms/sharedFoldersState';
import { showErrorToast, showSuccessToast } from './toastHelpers';
import './SharedInviteBanner.css';

export default function SharedInviteBanner({ onAccepted }) {
  const [invites, setInvites] = useAtom(pendingInvitesState);
  const [busy, setBusy] = useState(false);
  if (!invites.length) return null;
  const invite = invites[0];

  const respond = async (accept) => {
    setBusy(true);
    try {
      const res = await browser.runtime.sendMessage({ type: 'sharedRespondInvite', folderId: invite.folderId, accept });
      if (res?.ok) {
        setInvites(invites.slice(1));
        if (accept) { showSuccessToast(`"${invite.folderName}" was added to your folders`); onAccepted?.(); }
      } else {
        showErrorToast('Could not respond to the invite. Please try again.');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="shared-invite-banner" role="status">
      <MdFolderShared size={18} />
      <span>
        <strong>{invite.ownerEmail}</strong> wants to share the folder <strong>&quot;{invite.folderName}&quot;</strong> with you
        {invite.role === 'read' ? ' (view only)' : ''}
      </span>
      <button disabled={busy} onClick={() => respond(true)}>Accept</button>
      <button disabled={busy} className="decline" onClick={() => respond(false)}>Decline</button>
    </div>
  );
}
