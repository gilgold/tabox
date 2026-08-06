import React from 'react';
import { useSetAtom } from 'jotai';
import { aiToolsModalOpenState, aiToolsScopeState } from './atoms/aiState';
import { isAISupported } from './ai/aiClient';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import './AIButton.css';

// withDivider renders a toolbar divider in front of the button. It lives
// inside this component so the divider disappears together with the button
// when Tabox AI is disabled or unsupported.
function AIButton({ withDivider = false, selectedUids = null }) {
    const enabled = useTaboxAIEnabled();
    const setAIToolsOpen = useSetAtom(aiToolsModalOpenState);
    const setAIToolsScope = useSetAtom(aiToolsScopeState);

    // The flag can outlive API support (Chrome downgrade, profile moved) —
    // hide the button rather than offer tools that can only fail.
    if (!enabled || !isAISupported()) return null;

    const hasSelection = Array.isArray(selectedUids) && selectedUids.length > 0;

    const handleClick = () => {
        if (hasSelection) {
            setAIToolsScope({ type: 'selected', uids: selectedUids });
        } else {
            setAIToolsScope({ type: 'all' });
        }
        setAIToolsOpen(true);
    };

    const tooltip = hasSelection
        ? `AI actions for ${selectedUids.length} selected collection${selectedUids.length === 1 ? '' : 's'}`
        : 'Tabox AI tools';

    return (
        <>
            {withDivider && <div className="fp-toolbar-divider" />}
            <button
                type="button"
                className="ai-button"
                aria-label={tooltip}
                onClick={handleClick}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={tooltip}
            >
                <svg
                    className="ai-button-stars"
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                >
                    <path className="ai-star ai-star--1" d="M8 4 C8 10.72 9.28 12 16 12 C9.28 12 8 13.28 8 20 C8 13.28 6.72 12 0 12 C6.72 12 8 10.72 8 4 Z" />
                    <path className="ai-star ai-star--2" d="M17 0 C17 5.88 18.12 7 24 7 C18.12 7 17 8.12 17 14 C17 8.12 15.88 7 10 7 C15.88 7 17 5.88 17 0 Z" />
                    <path className="ai-star ai-star--3" d="M18 12 C18 17.04 18.96 18 24 18 C18.96 18 18 18.96 18 24 C18 18.96 17.04 18 12 18 C17.04 18 18 17.04 18 12 Z" />
                </svg>
                <span className="ai-button-label">AI</span>
            </button>
        </>
    );
}

export default AIButton;
