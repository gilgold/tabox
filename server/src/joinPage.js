// Static landing page for share links, served at GET /join/:token.
// The page never receives server-side data — its script reads the token from
// location.pathname, fetches public metadata from /links/:token, and hands the
// token to the extension via externally_connectable messaging.
export const TABOX_EXTENSION_ID = 'bdbliblipiempfdkkkjohnecmeknnpoa';
const STORE_URL = `https://chromewebstore.google.com/detail/${TABOX_EXTENSION_ID}`;

export const JOIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tabox — shared with you</title>
<style>
  :root { color-scheme: light dark; --fg: #1c2430; --muted: #5b6572; --bg: #f5f7fa; --card: #ffffff; --accent: #2f80ed; --border: #e1e6ec; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8ecf1; --muted: #9aa4b0; --bg: #141a21; --card: #1e2630; --border: #2c3642; } }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); display: grid; place-items: center; min-height: 100vh; padding: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 32px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 6px 0; }
  .meta { font-size: 13px; color: var(--muted); margin-bottom: 18px; }
  .status { margin-top: 18px; font-size: 15px; }
  .ok { color: #27ae60; font-weight: 600; }
  .err { color: #eb5757; font-weight: 600; }
  button, a.btn { display: inline-block; margin-top: 16px; padding: 10px 22px; border-radius: 8px; border: 0; background: var(--accent); color: #fff; font-size: 15px; cursor: pointer; text-decoration: none; }
  .spinner { margin: 18px auto 0; width: 22px; height: 22px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* !important: must also beat the a.btn display rule above (higher specificity). */
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="card">
  <h1 id="title">Loading…</h1>
  <p id="subtitle"></p>
  <div id="meta" class="meta"></div>
  <div id="spinner" class="spinner"></div>
  <div id="status" class="status hidden"></div>
  <button id="retry" class="hidden">Try again</button>
  <a id="install" class="btn hidden" href="${STORE_URL}" target="_blank" rel="noopener">Get Tabox for Chrome</a>
</div>
<script>
(function () {
  var EXT_ID = '${TABOX_EXTENSION_ID}';
  var token = decodeURIComponent(location.pathname.split('/').pop() || '');
  var el = function (id) { return document.getElementById(id); };
  var show = function (id) { el(id).classList.remove('hidden'); };
  var hide = function (id) { el(id).classList.add('hidden'); };
  var setStatus = function (text, cls) { var s = el('status'); s.textContent = text; s.className = 'status ' + cls; hide('spinner'); };

  function renderMeta(info) {
    if (info.kind === 'folder') {
      el('title').textContent = 'Join "' + info.name + '"';
      el('subtitle').textContent = info.ownerEmail + ' is sharing this folder with you.';
      el('meta').textContent = info.collectionCount + ' collection' + (info.collectionCount === 1 ? '' : 's') + ' · you can ' + (info.role === 'write' ? 'view and edit' : 'view');
    } else {
      el('title').textContent = 'Add "' + info.name + '"';
      el('subtitle').textContent = info.ownerEmail + ' shared a copy of this collection with you.';
      el('meta').textContent = info.tabCount + ' tab' + (info.tabCount === 1 ? '' : 's');
    }
  }

  function redeem(info) {
    if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return notInstalled(info);
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; notInstalled(info); } }, 1500);
    try {
      chrome.runtime.sendMessage(EXT_ID, { type: 'taboxShareLink', token: token }, function (reply) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError || !reply) return notInstalled(info);
        if (reply.status === 'joined') return setStatus('You joined "' + (reply.name || info.name) + '" ✓ — open Tabox to see it.', 'ok');
        if (reply.status === 'added') return setStatus('"' + (reply.name || info.name) + '" was added to your Tabox ✓', 'ok');
        if (reply.status === 'sign_in_required') {
          setStatus('Almost there — open Tabox, sign in with Google (Settings → Sync), then try again.', 'err');
          show('retry');
          return;
        }
        if (reply.error === 'member_limit') return setStatus('This folder is full (20 members max). Ask the owner to make room.', 'err');
        if (reply.error === 'already_owner') return setStatus('This is your own share link — it\\u2019s already in your Tabox.', 'err');
        setStatus('Something went wrong redeeming this link. Please try again.', 'err');
        show('retry');
      });
    } catch (e) { if (!done) { done = true; clearTimeout(timer); notInstalled(info); } }
  }

  function notInstalled(info) {
    setStatus('Install the Tabox extension, then reload this page to ' + (info.kind === 'folder' ? 'join the folder.' : 'add the collection.'), '');
    show('install');
  }

  el('retry').addEventListener('click', function () {
    hide('retry'); show('spinner');
    fetchInfo();
  });

  function fetchInfo() {
    fetch('/links/' + encodeURIComponent(token))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (info) { renderMeta(info); redeem(info); })
      .catch(function (status) {
        el('title').textContent = 'Link not found';
        el('subtitle').textContent = '';
        setStatus(status === 429
          ? 'Too many attempts — wait a minute and reload.'
          : 'This share link is invalid or was revoked by its owner.', 'err');
      });
  }
  fetchInfo();
})();
</script>
</body>
</html>`;
