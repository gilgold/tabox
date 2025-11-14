function sanitizeUrl(url) {
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

function extractUrlParams() {
    try {
        const url = new URL(window.location.href);
        const urlParams = url.searchParams;
        return Object.fromEntries(urlParams.entries());
    } catch (error) {
        console.error('Failed to extract URL parameters:', error);
        return {};
    }
}

const params = extractUrlParams();
const sanitizedUrl = sanitizeUrl(params.url);
const sanitizedFavicon = sanitizeUrl(params.favicon);

// Validation check
if (sanitizedUrl === '#') {
    console.error('Invalid or missing URL parameter');
    document.body.innerHTML = `
        <div style="text-align: center; padding: 50px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <h2>Error Loading Content</h2>
            <p>This tab cannot be loaded due to an invalid URL.</p>
            <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #177CB6; color: white; border: none; border-radius: 6px; cursor: pointer;">Close Tab</button>
        </div>
    `;
    throw new Error('Invalid URL - stopping execution');
}

// Focus-driven loading only
let redirected = false;
let redirectAttempts = 0;
const maxRedirectAttempts = 3;

// Safe redirect function with retry logic
function safeRedirect(url) {
    if (redirected || redirectAttempts >= maxRedirectAttempts) {
        return;
    }
    
    redirectAttempts++;
    redirected = true;
    
    try {
        // Try window.location.replace first (cleanest)
        window.location.replace(url);
    } catch (error) {
        console.warn('Redirect attempt failed:', error);
        
        // Fallback to window.location.href
        try {
            window.location.href = url;
        } catch (fallbackError) {
            console.error('All redirect methods failed:', fallbackError);
            // Show manual link as last resort
            showManualRedirectOption(url);
        }
    }
}

function showManualRedirectOption(url) {
    const container = document.querySelector('.defer-container');
    if (container) {
        container.innerHTML = `
            <div class="tabox-icon">⚠</div>
            <div class="message">Automatic redirect failed</div>
            <p class="sub-message">Please click the link below to continue:</p>
            <a href="${url}" class="button" target="_self" style="background: #e74c3c;">Go to Page</a>
        `;
    }
}

// 1. Load when tab receives focus (primary trigger)
window.addEventListener("focus", () => {
    if (sanitizedUrl === '#' || redirected) return;
    console.log('Tab focused - loading content');
    safeRedirect(sanitizedUrl);
});

// 2. Load when tab becomes visible (switched to)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sanitizedUrl !== '#' && !redirected) {
        console.log('Tab became visible - loading content');
        safeRedirect(sanitizedUrl);
    }
});

// 3. Load on any user interaction with the page
['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
    document.addEventListener(event, () => {
        if (sanitizedUrl === '#' || redirected) return;
        console.log('User interaction detected - loading content');
        safeRedirect(sanitizedUrl);
    }, { once: true });
});

// 4. Page setup and manual reload button
(() => {
    try {
        // Set favicon with fallback
        let link = document.querySelector("link[rel~='icon']");
        if (link) {
            if (sanitizedFavicon && sanitizedFavicon !== '#') {
                link.href = sanitizedFavicon;
            } else {
                // Fallback to Google's favicon service
                try {
                    const urlObj = new URL(sanitizedUrl);
                    link.href = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
                } catch (error) {
                    link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📄</text></svg>';
                }
            }
        }
        
        // Set page title with fallback
        try {
            const urlObj = new URL(sanitizedUrl);
            document.title = `${urlObj.hostname} (click to load)`;
        } catch (error) {
            document.title = 'Click to load content';
        }
        
        // Setup manual redirect button
        const redirectButton = document.getElementById("redirect-button");
        if (redirectButton) {
            redirectButton.href = sanitizedUrl;
            redirectButton.addEventListener('click', (e) => {
                e.preventDefault();
                if (sanitizedUrl === '#') return;
                console.log('Manual load button clicked');
                safeRedirect(sanitizedUrl);
            });
        }
        
    } catch (error) {
        console.error('Error setting up deferred loading page:', error);
    }
})();

// No automatic timers - purely user-driven loading
console.log('Deferred loading page ready - waiting for user interaction or focus');