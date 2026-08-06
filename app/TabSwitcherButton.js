import React from 'react';
import { useSetAtom } from 'jotai';
import { tabSwitcherOpenState } from './atoms/tabSwitcherState';
import { MdSwapHoriz } from 'react-icons/md';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const SHORTCUT_HINT = isMac ? '⌘⇧S' : 'Ctrl+Shift+S';

function TabSwitcherButton({ className = 'header-action-btn' }) {
    const setOpen = useSetAtom(tabSwitcherOpenState);
    return (
        <button
            className={className}
            onClick={() => setOpen(true)}
            data-testid="tab-switcher-button"
            data-tooltip-id="main-tooltip"
            data-tooltip-content={`Quick tab switcher (${SHORTCUT_HINT})`}
        >
            <MdSwapHoriz size={18} />
        </button>
    );
}

export default TabSwitcherButton;
