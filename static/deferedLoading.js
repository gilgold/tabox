const url = new URL(window.location.href);
const urlParams = url.searchParams;
const params = Object.fromEntries(urlParams.entries());

params.url = decodeURIComponent(params.url).trim().replaceAll(/\t|\n|\r/g, '')
if (params.url.indexOf("javascript:")==0) params.url = "#"

window.addEventListener("focus", () => {
    setTimeout(window.location.replace(params.url), 1);
});

(() => {
    let link = document.querySelector("link[rel~='icon']");
    link.href = params?.favicon === '' ? `https://s2.googleusercontent.com/s2/favicons?domain_url=${params.url}` : params.favicon;
    document.title = params.url;
    document.getElementById("redirect-button").href = params.url;
})();