import React from 'react';
import { useSetAtom } from 'jotai';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState, aiToolsScopeState } from './atoms/aiState';
import { isAISupported } from './ai/aiClient';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import './AIButton.css';

// withDivider renders a toolbar divider in front of the button. It lives
// inside this component so the divider disappears together with the button
// when Tabox AI is disabled or unsupported.
function AIButton({ withDivider = false }) {
    const enabled = useTaboxAIEnabled();
    const setAIToolsOpen = useSetAtom(aiToolsModalOpenState);
    const setAIToolsScope = useSetAtom(aiToolsScopeState);

    // The flag can outlive API support (Chrome downgrade, profile moved) —
    // hide the button rather than offer tools that can only fail.
    if (!enabled || !isAISupported()) return null;

    const handleClick = () => {
        // Always reset to 'all' scope so a stale 'selected' scope from the
        // full-page toolbar never leaks into a header-initiated session.
        setAIToolsScope({ type: 'all' });
        setAIToolsOpen(true);
    };

    return (
        <>
            {withDivider && <div className="fp-toolbar-divider" />}
            <button
                type="button"
                className="ai-button"
                aria-label="Tabox AI"
                onClick={handleClick}
                data-tooltip-id="main-tooltip"
                data-tooltip-content="Tabox AI tools"
            >
                <BsStars size={15} />
                <span className="ai-button-label">AI</span>
            </button>
        </>
    );
}

export default AIButton;
