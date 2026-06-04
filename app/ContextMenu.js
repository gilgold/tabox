import React, { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MdOutlineMoreHoriz } from 'react-icons/md';
import { useAtom } from 'jotai';
import { activeContextMenuState } from './atoms/animationsState';

function ContextMenu({
    menuItems = [],
    tooltip = "Options",
    tooltipPlace,
    onOpenChange,
    triggerRef,
}) {
    const [activeMenuId, setActiveMenuId] = useAtom(activeContextMenuState);
    const [menuPosition, setMenuPosition] = React.useState({ top: 0, right: 0 });
    // When opened via right-click, the menu is positioned at the cursor instead
    // of being anchored to the "..." button. null means button-anchored mode.
    const [cursorPosition, setCursorPosition] = React.useState(null);
    const menuButtonRef = useRef(null);
    // Generate a stable unique ID for this menu instance
    const menuId = useMemo(() => `context-menu-${Math.random().toString(36).substr(2, 9)}`, []);
    
    // Derive showMenu from global state
    const showMenu = activeMenuId === menuId;

    useEffect(() => {
        onOpenChange?.(showMenu);
    }, [onOpenChange, showMenu]);

    // Once the menu closes, clear any cursor position so the next "..." click
    // anchors to the button again.
    useEffect(() => {
        if (!showMenu) {
            setCursorPosition(null);
        }
    }, [showMenu]);

    // Allow a host element to open this same menu via right-click, positioned at
    // the cursor. Keeps a single menu definition shared with the "..." button.
    useEffect(() => {
        const triggerEl = triggerRef?.current;
        if (!triggerEl) {
            return undefined;
        }

        const handleContextMenu = (event) => {
            event.preventDefault();
            event.stopPropagation();

            const menuWidth = 220;
            const menuHeight = 280;
            const pad = 8;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let x = event.clientX;
            let y = event.clientY;
            if (x + menuWidth + pad > vw) x = vw - menuWidth - pad;
            if (y + menuHeight + pad > vh) y = vh - menuHeight - pad;
            if (x < pad) x = pad;
            if (y < pad) y = pad;

            setCursorPosition({ x, y });
            setActiveMenuId(menuId);
        };

        triggerEl.addEventListener('contextmenu', handleContextMenu);
        return () => triggerEl.removeEventListener('contextmenu', handleContextMenu);
    }, [triggerRef, menuId, setActiveMenuId]);

    // Filter menu items based on condition (if provided)
    const visibleMenuItems = menuItems.filter(item => {
        if (item.condition !== undefined) {
            return item.condition;
        }
        return true;
    });

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showMenu && menuButtonRef.current && !menuButtonRef.current.contains(event.target)) {
                const menu = document.getElementById(menuId);
                if (menu && !menu.contains(event.target)) {
                    setActiveMenuId(null);
                }
            }
        };

        if (showMenu) {
            document.addEventListener('click', handleClickOutside);
            
            // Calculate position immediately when menu opens
            if (menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                const menuSpacing = 5; // Space between button and menu
                
                // Default to positioning below button
                // The refinement effect will adjust if needed after actual height is known
                setMenuPosition({
                    top: rect.bottom + menuSpacing,
                    right: window.innerWidth - rect.right
                });
            }
        }

        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, [showMenu, visibleMenuItems.length, menuId, setActiveMenuId]);

    // Refine position after menu renders with actual height
    useEffect(() => {
        // In cursor mode the menu is already clamped to the viewport at open
        // time and has no button to anchor to, so skip button-relative refinement.
        if (cursorPosition || !showMenu || !menuButtonRef.current) {
            return;
        }

        // Use requestAnimationFrame to ensure menu is fully rendered before checking position
        const rafId = requestAnimationFrame(() => {
            const menu = document.getElementById(menuId);
            if (menu) {
                const menuRect = menu.getBoundingClientRect();
                const buttonRect = menuButtonRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const menuSpacing = 5;
                
                // Determine if menu is positioned above or below the button
                const isAboveButton = menuRect.bottom < buttonRect.top;
                const isBelowButton = menuRect.top > buttonRect.bottom;
                
                // Check if there are issues that need correction
                const isCutOffAtBottom = menuRect.bottom > viewportHeight;
                const hasExcessiveGapAbove = isAboveButton && (buttonRect.top - menuRect.bottom) > menuSpacing + 5;
                
                if (isBelowButton && !isCutOffAtBottom) {
                    // Menu is below and fits fine - don't adjust
                    return;
                } else if (isCutOffAtBottom && buttonRect.top > menuRect.height + menuSpacing) {
                    // Menu is cut off at bottom and there's space above - move it above
                    setMenuPosition(prev => ({
                        ...prev,
                        top: buttonRect.top - menuRect.height - menuSpacing
                    }));
                } else if (hasExcessiveGapAbove) {
                    // Menu is above but with excessive gap - close the gap
                    const idealTop = buttonRect.top - menuRect.height - menuSpacing;
                    const finalTop = Math.max(10, idealTop);
                    setMenuPosition(prev => ({
                        ...prev,
                        top: finalTop
                    }));
                } else if (isCutOffAtBottom) {
                    // Menu is cut off but no space above - constrain to viewport
                    const maxTop = viewportHeight - menuRect.height - 10;
                    setMenuPosition(prev => ({
                        ...prev,
                        top: Math.max(10, Math.min(prev.top, maxTop))
                    }));
                }
            }
        });

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [showMenu, visibleMenuItems.length, menuId, cursorPosition]);

    const handleMenuClick = (e) => {
        e.stopPropagation();
        // Toggle: if this menu is open, close it; otherwise open it (and close any other)
        setActiveMenuId(showMenu ? null : menuId);
    };

    const handleMenuItemClick = (action) => {
        if (action && typeof action === 'function') {
            action();
        }
        setActiveMenuId(null);
    };

    return (
        <>
            <span 
                ref={menuButtonRef}
                className="action-icon menu-icon"
                data-tooltip-id="main-tooltip" data-tooltip-content={tooltip}
                data-tooltip-place={tooltipPlace}
                onClick={handleMenuClick}
            >
                <MdOutlineMoreHoriz />
            </span>
            {showMenu && createPortal(
                <div
                    id={menuId}
                    className="context-menu"
                    style={cursorPosition ? {
                        top: `${cursorPosition.y}px`,
                        left: `${cursorPosition.x}px`,
                        position: 'fixed'
                    } : {
                        top: `${menuPosition.top}px`,
                        right: `${menuPosition.right}px`,
                        position: 'fixed'
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {visibleMenuItems.length > 0 ? (
                        visibleMenuItems.map((item, index) => (
                            <div 
                                key={item.id || index}
                                className={`context-menu-item ${item.className || ''}`}
                                onClick={() => handleMenuItemClick(item.action)}
                            >
                                {item.icon && <span className="menu-item-icon">{item.icon}</span>}
                                <span className="menu-item-text">{item.text}</span>
                            </div>
                        ))
                    ) : (
                        <div className="context-menu-item">
                            <span className="menu-item-text">No menu items configured</span>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}

export default ContextMenu;
