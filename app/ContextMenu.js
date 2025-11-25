import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MdOutlineMoreHoriz } from 'react-icons/md';

function ContextMenu({ 
    menuItems = [],
    tooltip = "Options"
}) {
    const [showMenu, setShowMenu] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
    const menuButtonRef = useRef(null);
    const menuRef = useRef(null);
    const menuId = useRef(`context-menu-${Math.random().toString(36).substr(2, 9)}`);

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
                const menu = document.getElementById(menuId.current);
                if (menu && !menu.contains(event.target)) {
                    setShowMenu(false);
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
    }, [showMenu, visibleMenuItems.length]);

    // Refine position after menu renders with actual height
    useEffect(() => {
        if (!showMenu || !menuButtonRef.current) {
            return;
        }

        // Use requestAnimationFrame to ensure menu is fully rendered before checking position
        const rafId = requestAnimationFrame(() => {
            const menu = document.getElementById(menuId.current);
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
    }, [showMenu, visibleMenuItems.length]);

    const handleMenuClick = (e) => {
        e.stopPropagation();
        setShowMenu(!showMenu);
    };

    const handleMenuItemClick = (action) => {
        if (action && typeof action === 'function') {
            action();
        }
        setShowMenu(false);
    };

    return (
        <>
            <span 
                ref={menuButtonRef}
                className="action-icon menu-icon"
                data-tooltip-id="main-tooltip" data-tooltip-content={tooltip}
                onClick={handleMenuClick}
            >
                <MdOutlineMoreHoriz />
            </span>
            {showMenu && createPortal(
                <div 
                    id={menuId.current}
                    className="context-menu" 
                    style={{
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