import React from 'react';
import { useSetAtom } from 'jotai';
import { BsStars } from 'react-icons/bs';
import { useTaboxAIEnabled } from '../ai/useTaboxAIEnabled';
import { isAISupported } from '../ai/aiClient';
import { aiToolsModalOpenState, aiToolsScopeState } from '../atoms/aiState';

/**
 * AI toolbar button for the full-page collection-selection toolbar.
 * Renders only when Tabox AI is enabled and the Prompt API is available.
 *
 * @param {{ selectedUids: string[] }} props
 */
export default function FPSelectionAIButton({ selectedUids }) {
    const aiEnabled = useTaboxAIEnabled();
    const setAiToolsModalOpen = useSetAtom(aiToolsModalOpenState);
    const setAiToolsScope = useSetAtom(aiToolsScopeState);

    if (!aiEnabled || !isAISupported()) {
        return null;
    }

    const handleClick = () => {
        setAiToolsScope({ type: 'selected', uids: selectedUids });
        setAiToolsModalOpen(true);
    };

    return (
        <button
            type="button"
            className="fp-toolbar-btn fp-toolbar-ai-btn"
            onClick={handleClick}
            disabled={selectedUids.length === 0}
            aria-label="AI actions for selected collections"
            data-tooltip-id="main-tooltip"
            data-tooltip-content="AI actions for selected collections"
        >
            <BsStars size={16} />
            <span className="fp-toolbar-btn-label fp-toolbar-ai-label">AI</span>
        </button>
    );
}
