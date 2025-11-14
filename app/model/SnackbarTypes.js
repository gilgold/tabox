export const SnackbarStyle = {
    ERROR: {
        // Clean text-only error design - no background to prevent nesting
        // Compact Liquid Glass Error Design
        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.95) 0%, rgba(220, 38, 38, 0.98) 100%)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        border: '1px solid rgba(255, 255, 255, 0.25)',
        borderRadius: '12px',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'center',
        padding: 0,
        boxShadow: `
            0 4px 20px rgba(239, 68, 68, 0.25),
            0 2px 8px rgba(0, 0, 0, 0.1),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.3)
        `,
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
        minHeight: 'auto',
        maxWidth: '400px',
        width: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: '1.4',
        margin: '0',
        position: 'relative',
        overflow: 'hidden'
    },
    SUCCESS: {
        // Compact Liquid Glass Success Design
        background: 'linear-gradient(135deg, rgba(16, 144, 63, 0.95) 0%, rgba(16, 144, 63, 0.95) 100%)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        border: '1px solid rgba(255, 255, 255, 0.25)',
        borderRadius: '10px',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'center',
        padding: 0,
        boxShadow: `
            0 4px 20px rgba(34, 197, 94, 0.25),
            0 2px 8px rgba(0, 0, 0, 0.1),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.3)
        `,
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
        minHeight: 'auto',
        maxWidth: '400px',
        width: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: '1.4',
        margin: '0',
        position: 'relative',
        overflow: 'hidden'
    },
    INFO: {
        // Clean text-only info design - no background to prevent nesting
        background: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        border: 'none',
        borderRadius: '0',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'center',
        padding: '0',
        boxShadow: 'none',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
        minHeight: 'auto',
        maxWidth: 'none',
        width: 'auto',
        display: 'inline-block',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: '1.4',
        margin: '0',
        position: 'relative',
        overflow: 'visible'
    }
};