function sanitizeUrl(url) {
    try {
        const sanitizedURL = decodeURIComponent(url).trim().replaceAll(/\t|\n|\r/g, '');
        const urlObj = new URL(sanitizedURL);
        if (urlObj.protocol === 'javascript:') {
            return '#';
        }
        return sanitizedURL;
    } catch (error) {
        return '#';
    }
}

const url = new URL(window.location.href);
const urlParams = url.searchParams;
const params = Object.fromEntries(urlParams.entries());
const sanitizedUrl = sanitizeUrl(params.url);
const sanitizedFavicon = sanitizeUrl(params.favicon);

window.addEventListener("focus", () => {
    if (sanitizedUrl === '#') return;
    setTimeout(window.location.replace(sanitizedUrl), 1);
});

(() => {
    let link = document.querySelector("link[rel~='icon']");
    link.href = params?.favicon === '' ? `https://s2.googleusercontent.com/s2/favicons?domain_url=${sanitizedUrl}` : sanitizedFavicon;
    document.title = sanitizedUrl;
    document.getElementById("redirect-button").href = sanitizedUrl;
})();