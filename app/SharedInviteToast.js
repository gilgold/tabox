import React from 'react';
import { MdFolderShared } from 'react-icons/md';
import { IoClose } from 'react-icons/io5';
import './SharedInviteToast.css';

/**
 * Presentational card for a shared-folder invite toast. Rendered by
 * SharedInviteToastController via toast.custom(); persistent (no countdown)
 * until the user accepts, declines, or dismisses it.
 */
export default function SharedInviteToast({
  visible,
  invite,
  busy,
  onAccept,
  onDecline,
  onDismiss,
}) {
  return (
    <div
      className={`shared-invite-toast${visible ? ' shared-invite-toast--visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="shared-invite-toast-card">
        <button
          className="shared-invite-toast-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss invite"
          data-tooltip-id="main-tooltip"
          data-tooltip-content="Dismiss for now"
          data-tooltip-class-name="small-tooltip"
        >
          <IoClose size={14} />
        </button>
        <div className="shared-invite-toast-badge">
          <MdFolderShared size={20} />
        </div>
        <div className="shared-invite-toast-content">
          <div className="shared-invite-toast-kicker">Folder invitation</div>
          <div className="shared-invite-toast-text">
            <strong>{invite.ownerFirstName || invite.ownerEmail}</strong> invited you to <strong>&quot;{invite.folderName}&quot;</strong>
            {invite.role === 'read' && (
              <span className="shared-invite-toast-role">view only</span>
            )}
          </div>
          <div className="shared-invite-toast-actions">
            <button
              className="shared-invite-toast-accept"
              disabled={busy}
              onClick={onAccept}
            >
              Accept
            </button>
            <button
              className="shared-invite-toast-decline"
              disabled={busy}
              onClick={onDecline}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
