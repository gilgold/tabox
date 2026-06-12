import React from 'react';
import { useSetAtom } from 'jotai';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState } from './atoms/aiState';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import './AIButton.css';

function AIButton() {
    const enabled = useTaboxAIEnabled();
    const setAIToolsOpen = useSetAtom(aiToolsModalOpenState);

    if (!enabled) return null;

    return (
        <button
            type="button"
            className="ai-button"
            aria-label="Tabox AI"
            onClick={() => setAIToolsOpen(true)}
            data-tooltip-id="main-tooltip"
            data-tooltip-content="Tabox AI tools"
        >
            <BsStars size={15} />
            <span className="ai-button-label">AI</span>
        </button>
    );
}

export default AIButton;
