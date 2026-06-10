import { useState, useCallback, useEffect } from 'react';

// Palette-style list keyboard navigation: wrapping arrows, Home/End,
// Enter selects, Escape closes. Selection resets when resetKey changes
// (pass the search query so new filters start at the top).
export default function useListNavigation({ count, onSelect, onClose, scrollTo, resetKey }) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        setSelectedIndex(0);
    }, [resetKey]);

    const move = useCallback((next) => {
        setSelectedIndex(next);
        scrollTo?.(next);
    }, [scrollTo]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose?.();
            return;
        }
        if (count === 0) return;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                move(selectedIndex < count - 1 ? selectedIndex + 1 : 0);
                break;
            case 'ArrowUp':
                e.preventDefault();
                move(selectedIndex > 0 ? selectedIndex - 1 : count - 1);
                break;
            case 'Home':
                e.preventDefault();
                move(0);
                break;
            case 'End':
                e.preventDefault();
                move(count - 1);
                break;
            case 'Enter':
                e.preventDefault();
                onSelect?.(selectedIndex);
                break;
        }
    }, [count, selectedIndex, move, onSelect, onClose]);

    return { selectedIndex, setSelectedIndex, handleKeyDown };
}
