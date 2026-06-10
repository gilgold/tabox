export function sanitizeUrl(url) {
    try {
        if (!url || typeof url !== 'string') {
            return '#';
        }

        // Do NOT decodeURIComponent here. The caller already supplies the real, decoded
        // URL (the hash JSON payload, or URLSearchParams which decodes once). A second
        // decode corrupts valid URLs whose path/query legitimately contain percent-encoded
        // reserved characters (e.g. %26, %2B, %23) - turning `?a=1%26b=2` into two params.
        // We only strip control characters / surrounding whitespace, then validate the
        // scheme via the URL parser (which rejects javascript:, data:, etc.).
        const sanitizedURL = url.trim().replaceAll(/\t|\n|\r/g, '');

        // Additional validation
        if (sanitizedURL === '' || sanitizedURL === 'undefined' || sanitizedURL === 'null') {
            return '#';
        }
        
        const urlObj = new URL(sanitizedURL);
        
        // Block potentially dangerous protocols
        const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
        if (dangerousProtocols.includes(urlObj.protocol)) {
            return '#';
        }
        
        // Ensure we have a valid HTTP/HTTPS URL
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return '#';
        }
        
        return sanitizedURL;
    } catch (error) {
        console.warn('URL sanitization failed:', error);
        return '#';
    }
}

export function extractUrlParams(href = window.location.href) {
    try {
        const url = new URL(href);

        // Current format: a JSON payload in the hash fragment, e.g.
        //   deferedLoading.html#<encodeURIComponent(JSON.stringify({ url, favicon }))>
        // The hash is never sent in the request, so ad-blocker filters that match the
        // legacy `?url=http...` redirect pattern can't block the placeholder page.
        if (url.hash && url.hash.length > 1) {
            try {
                const decoded = JSON.parse(decodeURIComponent(url.hash.slice(1)));
                if (decoded && typeof decoded === 'object') {
                    return decoded;
                }
            } catch {
                // Malformed hash payload - fall back to legacy query parsing.
            }
        }

        // Legacy format (<= v4.1): ?url=<enc>&favicon=<enc>
        return Object.fromEntries(url.searchParams.entries());
    } catch (error) {
        console.error('Failed to extract URL parameters:', error);
        return {};
    }
}

export function showManualRedirectOption(url, doc = document) {
    const container = doc.querySelector('.defer-container');
    if (!container) {
        return;
    }

    // SECURITY: never interpolate the URL into the innerHTML string. `sanitizeUrl` only
    // validates the scheme and returns the raw URL, so a value like
    // `https://evil/"><img src=x onerror=...>` would break out of the href attribute and
    // inject markup. Build the static markup first, then assign the href as a *property*
    // (treated as data, not parsed as HTML).
    container.innerHTML = `
            <div class="tabox-icon">⚠</div>
            <div class="message">Automatic redirect failed</div>
            <p class="sub-message">Please click the link below to continue:</p>
            <a id="manual-redirect-link" class="button" target="_self" style="background: #e74c3c;">Go to Page</a>
        `;

    const link = doc.getElementById ? doc.getElementById('manual-redirect-link') : null;
    if (link) {
        link.href = url;
    }
}

export function initializeDeferredLoading({
    win = window,
    doc = document,
    logger = console,
} = {}) {
    const params = extractUrlParams(win.location.href);
    const sanitizedUrl = sanitizeUrl(params.url);
    const sanitizedFavicon = sanitizeUrl(params.favicon);

    if (sanitizedUrl === '#') {
        logger.error('Invalid or missing URL parameter');
        // This page is a normal (non-sandboxed) extension page under
        // `script-src 'self'`, so inline event handlers (onclick=...) are blocked by CSP.
        // Wire the close button via addEventListener instead.
        doc.body.innerHTML = `
            <div style="text-align: center; padding: 50px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                <h2>Error Loading Content</h2>
                <p>This tab cannot be loaded due to an invalid URL.</p>
                <button id="defer-close-button" style="margin-top: 20px; padding: 10px 20px; background: #177CB6; color: white; border: none; border-radius: 6px; cursor: pointer;">Close Tab</button>
            </div>
        `;
        const closeButton = doc.getElementById && doc.getElementById('defer-close-button');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                try {
                    win.close();
                } catch (closeError) {
                    logger.warn('Unable to close tab:', closeError);
                }
            });
        }
        throw new Error('Invalid URL - stopping execution');
    }

    let redirected = false;
    let redirectAttempts = 0;
    const maxRedirectAttempts = 3;

    const safeRedirect = (url) => {
        if (redirected || redirectAttempts >= maxRedirectAttempts) {
            return;
        }

        redirectAttempts++;
        redirected = true;

        try {
            win.location.replace(url);
        } catch (error) {
            logger.warn('Redirect attempt failed:', error);

            try {
                win.location.href = url;
            } catch (fallbackError) {
                logger.error('All redirect methods failed:', fallbackError);
                showManualRedirectOption(url, doc);
            }
        }
    };

    win.addEventListener('focus', () => {
        if (sanitizedUrl === '#' || redirected) return;
        logger.log('Tab focused - loading content');
        safeRedirect(sanitizedUrl);
    });

    doc.addEventListener('visibilitychange', () => {
        if (!doc.hidden && sanitizedUrl !== '#' && !redirected) {
            logger.log('Tab became visible - loading content');
            safeRedirect(sanitizedUrl);
        }
    });

    ['click', 'keydown', 'touchstart', 'mousedown'].forEach((event) => {
        doc.addEventListener(event, () => {
            if (sanitizedUrl === '#' || redirected) return;
            logger.log('User interaction detected - loading content');
            safeRedirect(sanitizedUrl);
        }, { once: true });
    });

    try {
        let link = doc.querySelector("link[rel~='icon']");
        if (link) {
            if (sanitizedFavicon && sanitizedFavicon !== '#') {
                link.href = sanitizedFavicon;
            } else {
                try {
                    const urlObj = new URL(sanitizedUrl);
                    link.href = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
                } catch {
                    link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📄</text></svg>';
                }
            }
        }

        try {
            const urlObj = new URL(sanitizedUrl);
            doc.title = `${urlObj.hostname} (click to load)`;
        } catch {
            doc.title = 'Click to load content';
        }

        const redirectButton = doc.getElementById('redirect-button');
        if (redirectButton) {
            redirectButton.href = sanitizedUrl;
            redirectButton.addEventListener('click', (event) => {
                event.preventDefault();
                if (sanitizedUrl === '#') return;
                logger.log('Manual load button clicked');
                safeRedirect(sanitizedUrl);
            });
        }
    } catch (error) {
        logger.error('Error setting up deferred loading page:', error);
    }

    logger.log('Deferred loading page ready - waiting for user interaction or focus');

    return {
        sanitizedUrl,
        sanitizedFavicon,
        safeRedirect,
        getRedirectState: () => ({
            redirected,
            redirectAttempts,
            maxRedirectAttempts,
        }),
    };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initializeDeferredLoading();
}
