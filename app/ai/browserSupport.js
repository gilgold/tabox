// Tabox AI runs on Chrome's built-in Gemini Nano (the LanguageModel global).
// Feature detection alone cannot gate it: other Chromium browsers either lack
// the API entirely (Brave, Vivaldi) or ship their own incompatible model
// behind the same global (Edge's Phi-based Prompt API). Detect the actual
// browser brand so AI features are only offered in real Google Chrome.

const CHROME = 'Google Chrome';

// Exported for tests. Synchronous on purpose — navigator.brave existing at all
// identifies Brave, without awaiting isBrave(). An unidentified Chromium fails
// open as Chrome: the LanguageModel feature check still gates functionality,
// so a wrong "Chrome" guess can never enable AI where it doesn't exist.
export function detectBrowserName(nav = globalThis.navigator) {
    if (!nav) return CHROME;
    if (nav.brave) return 'Brave';
    const brands = (nav.userAgentData?.brands || []).map((entry) => entry.brand);
    if (brands.includes('Microsoft Edge')) return 'Microsoft Edge';
    if (brands.includes('Opera')) return 'Opera';
    if (brands.includes('Brave')) return 'Brave';
    const ua = nav.userAgent || '';
    if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return 'Microsoft Edge';
    if (/\bOPR\//.test(ua)) return 'Opera';
    if (/\bVivaldi\//.test(ua)) return 'Vivaldi';
    return CHROME;
}

let cachedName = null;

export function getBrowserName() {
    if (cachedName === null) cachedName = detectBrowserName();
    return cachedName;
}

export function isChromeBrowser() {
    return getBrowserName() === CHROME;
}
