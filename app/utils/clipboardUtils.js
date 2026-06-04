/**
 * Clipboard helpers.
 *
 * Copying text to the clipboard from an extension popup is best served by the
 * async Clipboard API, but that API is unavailable in some contexts (older
 * builds, insecure origins, certain sandboxes). A legacy `execCommand('copy')`
 * fallback covers those cases.
 */

/**
 * Copy text to the clipboard.
 *
 * Prefers `navigator.clipboard.writeText`; falls back to a hidden textarea and
 * `document.execCommand('copy')` when the async API is missing or fails. Rejects
 * if neither path succeeds so callers can surface an error to the user.
 *
 * @param {string} text
 * @returns {Promise<void>} resolves on success, rejects on total failure
 */
export const copyToClipboard = async (text) => {
    if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Fall through to the legacy execCommand path below.
        }
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        let succeeded = false;
        try {
            succeeded = document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }

        if (succeeded) {
            return;
        }
    } catch {
        // Fall through to the rejection below.
    }

    throw new Error('Failed to copy text to clipboard');
};
