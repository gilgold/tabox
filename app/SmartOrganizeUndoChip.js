// app/SmartOrganizeUndoChip.js
import React from 'react';
import { MdUndo, MdClose } from 'react-icons/md';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import { isAISupported } from './ai/aiClient';
import { useSmartOrganizeUndo } from './ai/useSmartOrganizeUndo';
import './SmartOrganizeUndoChip.css';

function SmartOrganizeUndoChip() {
    const enabled = useTaboxAIEnabled();
    const { snapshot, undo, dismiss } = useSmartOrganizeUndo();

    if (!enabled || !isAISupported() || !snapshot) return null;

    return (
        <div className="so-undo-chip">
            <button
                type="button"
                className="so-undo-chip-action"
                onClick={() => undo()}
                aria-label="Undo Smart Organize"
                data-tooltip-id="main-tooltip"
                data-tooltip-content="Undo the last Smart Organize"
            >
                <MdUndo size={14} />
                <span>Undo organize</span>
            </button>
            <button type="button" className="so-undo-chip-dismiss" onClick={() => dismiss()} aria-label="Dismiss undo">
                <MdClose size={13} />
            </button>
        </div>
    );
}

export default SmartOrganizeUndoChip;
