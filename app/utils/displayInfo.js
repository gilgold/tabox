import { browser } from '../../static/globals';

// browser.system.display is Chrome-only (not implemented in Firefox), so every
// caller goes through this guard. The fallback pretends the primary screen is
// the only display: window-position restore clamps to it instead of throwing
// and aborting the whole collection-open flow.
export const getDisplayInfo = async () => {
    try {
        if (browser.system?.display?.getInfo) {
            return await browser.system.display.getInfo();
        }
    } catch {
        // fall through to the pseudo-display
    }
    return [{
        bounds: {
            top: 0,
            left: 0,
            width: window.screen.width,
            height: window.screen.height,
        },
    }];
};
