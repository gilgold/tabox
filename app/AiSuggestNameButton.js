// app/AiSuggestNameButton.js
import React, { useState } from 'react';
import { BsStars } from 'react-icons/bs';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import { isAISupported } from './ai/aiClient';
import { showErrorToast } from './toastHelpers';
import './AiSuggestNameButton.css';

// Small sparkle icon shown inside name inputs. On click it calls the
// caller-supplied suggest() and hands the result back via onSuggested so the
// field can fill itself. It never persists anything. onBusyChange lets the
// surrounding field show the shared .ai-name-processing effect while thinking.
function AiSuggestNameButton({
    suggest,
    onSuggested,
    onBusyChange,
    disabled = false,
    disabledReason,
    label = 'Suggest name with AI',
}) {
    const enabled = useTaboxAIEnabled();
    const [busy, setBusy] = useState(false);

    if (!enabled || !isAISupported()) return null;

    const handleClick = async () => {
        if (busy || disabled) return;
        setBusy(true);
        if (onBusyChange) onBusyChange(true);
        try {
            const name = await suggest();
            const trimmed = (name || '').trim();
            if (trimmed && onSuggested) onSuggested(trimmed);
        } catch (err) {
            console.error('AI name suggestion failed:', err);
            showErrorToast('Could not generate a name. Please try again.');
        } finally {
            setBusy(false);
            if (onBusyChange) onBusyChange(false);
        }
    };

    return (
        <span
            className="ai-suggest-name-btn-wrap"
            data-tooltip-id="main-tooltip"
            data-tooltip-content={disabled && disabledReason ? disabledReason : label}
        >
            <button
                type="button"
                className={`ai-suggest-name-btn${busy ? ' ai-suggest-name-btn--busy' : ''}`}
                onClick={handleClick}
                disabled={disabled || busy}
                aria-busy={busy}
                aria-label={label}
            >
                <BsStars size={14} />
            </button>
        </span>
    );
}

export default AiSuggestNameButton;
