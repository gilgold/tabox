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
                <BsStars size={15} />
                <span className="ai-button-label">AI</span>
            </button>
        </>
    );
}

export default AIButton;
