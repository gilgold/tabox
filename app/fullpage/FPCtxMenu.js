import React from 'react';
import { createPortal } from 'react-dom';
import ProBadge from '../ProBadge';

// Positioned right-click context menu shared by the full-page views
// (FPSidebar folder menu, FPContentArea folder + collection card menus).
// Renders items produced by the shared builders in
// app/utils/contextMenuItems.js; a divider is drawn whenever `group`
// changes between consecutive visible items.
function FPCtxMenu({ menuRef, x, y, items = [], variant = 'sidebar' }) {
    const prefix = variant === 'card' ? 'fp-card-ctx' : 'fp-sidebar-ctx';
    const visibleItems = items.filter((item) => item.condition !== false);
    return createPortal(
        <div ref={menuRef} className={`${prefix}-menu`} style={{ top: y, left: x }}>
            {visibleItems.map((item, index) => (
                <React.Fragment key={item.id || index}>
                    {index > 0 && item.group !== visibleItems[index - 1].group && (
                        <div className={`${prefix}-divider`} />
                    )}
                    <button
                        className={`${prefix}-item ${item.className === 'danger' ? `${prefix}-danger` : ''}`.trim()}
                        onClick={item.action}
                    >
                        {item.icon} <span>{item.text}</span>
                        {item.proBadge && <ProBadge />}
                    </button>
                </React.Fragment>
            ))}
        </div>,
        document.body
    );
}

export default FPCtxMenu;
