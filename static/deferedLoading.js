export function sanitizeUrl(url) {
    try {
        if (!url || typeof url !== 'string') {
            return '#';
        }
        
        const sanitizedURL = decodeURIComponent(url).trim().replaceAll(/\t|\n|\r/g, '');
        
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
        const urlParams = url.searchParams;
        return Object.fromEntries(urlParams.entries());
    } catch (error) {
        console.error('Failed to extract URL parameters:', error);
        return {};
    }
}

export function showManualRedirectOption(url, doc = document) {
    const container = doc.querySelector('.defer-container');
    if (container) {
        container.innerHTML = `
            <div class="tabox-icon">⚠</div>
            <div class="message">Automatic redirect failed</div>
            <p class="sub-message">Please click the link below to continue:</p>
            <a href="${url}" class="button" target="_self" style="background: #e74c3c;">Go to Page</a>
        `;
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
        doc.body.innerHTML = `
            <div style="text-align: center; padding: 50px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                <h2>Error Loading Content</h2>
                <p>This tab cannot be loaded due to an invalid URL.</p>
                <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #177CB6; color: white; border: none; border-radius: 6px; cursor: pointer;">Close Tab</button>
            </div>
        `;
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
                } catch (error) {
                    link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📄</text></svg>';
                }
            }
        }

        try {
            const urlObj = new URL(sanitizedUrl);
            doc.title = `${urlObj.hostname} (click to load)`;
        } catch (error) {
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
