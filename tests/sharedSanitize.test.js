import { sanitizeRemoteCollection } from '../chrome/shared-folders';

test('keeps only whitelisted fields and forces safe defaults', () => {
  const dirty = {
    name: 'ok',
    tabs: [],
    shared: { folderId: 'evil' },
    parentId: 'evil-folder',
    __proto__pollution: 'x',
    dangerouslySetInnerHTML: 'x',
    uid: 'spoofed',
  };
  const clean = sanitizeRemoteCollection(dirty);
  expect(clean).toEqual({ name: 'ok', tabs: [] });        // no shared/parentId/uid leakage
});

test('drops tabs with dangerous URL schemes, keeps http(s)/about/chrome', () => {
  const clean = sanitizeRemoteCollection({
    name: 'n',
    tabs: [
      { url: 'https://ok.com', title: 't' },
      { url: 'http://ok.com', title: 't' },
      { url: 'javascript:alert(1)', title: 'xss' },
      { url: 'data:text/html,<script>1</script>', title: 'xss' },
      { url: 'file:///etc/passwd', title: 'lfi' },
      { url: 'blob:https://x', title: 'blob' },
      { url: 'chrome://settings', title: 'ok-ish' },
      { url: 'not a url', title: 'junk' },
    ],
  });
  expect(clean.tabs.map((t) => t.url)).toEqual(['https://ok.com', 'http://ok.com', 'chrome://settings']);
});

test('handles garbage input and truncates absurd names', () => {
  expect(sanitizeRemoteCollection(null)).toEqual({ name: 'Untitled', tabs: [] });
  expect(sanitizeRemoteCollection('string')).toEqual({ name: 'Untitled', tabs: [] });
  expect(sanitizeRemoteCollection({ name: 'x'.repeat(9999) }).name).toHaveLength(500);
});

test('drops adversarial URL schemes: leading space, uppercase, extension://, //', () => {
  const clean = sanitizeRemoteCollection({
    name: 'adversarial',
    tabs: [
      { url: ' javascript:alert(1)', title: 'leading space' },
      { url: 'JAVASCRIPT:alert(1)', title: 'uppercase' },
      { url: 'chrome-extension://x', title: 'extension' },
      { url: '//evil.com', title: 'protocol-relative' },
      { url: 'https://ok.com', title: 'safe' },
    ],
  });
  expect(clean.tabs.map((t) => t.url)).toEqual(['https://ok.com']);
});

test('drops tabs array containing non-object entries without throwing', () => {
  const clean = sanitizeRemoteCollection({
    name: 'garbage-tabs',
    tabs: [
      { url: 'https://ok.com', title: 't' },
      null,
      42,
      { url: 'https://another.com', title: 't2' },
    ],
  });
  // null and 42 cause .url access to fail; they are filtered out by the URL constructor try-catch
  // Actually, they'll trigger the catch clause and be filtered out
  expect(clean.tabs.length).toBeLessThanOrEqual(2);
  expect(clean.tabs.map((t) => t.url)).toContain('https://ok.com');
});

test('sanitizes favIconUrl: keeps http(s), drops javascript/data/invalid', () => {
  const clean = sanitizeRemoteCollection({
    name: 'favicon-test',
    tabs: [
      { url: 'https://safe.com', title: 't', favIconUrl: 'https://ok.com/f.ico' },
      { url: 'https://xss.com', title: 't', favIconUrl: 'javascript:alert(1)' },
      { url: 'https://data.com', title: 't', favIconUrl: 'data:image/png;base64,iVBORw0KG=' },
      { url: 'https://bad-url.com', title: 't', favIconUrl: 'not a url' },
      { url: 'https://normal.com', title: 't', favIconUrl: 'http://cdn.com/f.ico' },
    ],
  });
  expect(clean.tabs.length).toBe(5);
  // safe.com keeps favIconUrl (https)
  expect(clean.tabs[0].favIconUrl).toBe('https://ok.com/f.ico');
  // xss.com loses favIconUrl (javascript)
  expect(clean.tabs[1].favIconUrl).toBeUndefined();
  // data.com loses favIconUrl (data)
  expect(clean.tabs[2].favIconUrl).toBeUndefined();
  // bad-url.com loses favIconUrl (invalid)
  expect(clean.tabs[3].favIconUrl).toBeUndefined();
  // normal.com keeps favIconUrl (http)
  expect(clean.tabs[4].favIconUrl).toBe('http://cdn.com/f.ico');
});

test('does not mutate input tabs when sanitizing favIconUrl', () => {
  const inputTab = { url: 'https://x.com', title: 't', favIconUrl: 'javascript:bad' };
  const original = JSON.parse(JSON.stringify(inputTab)); // deep copy to compare
  sanitizeRemoteCollection({
    name: 'mutation-test',
    tabs: [inputTab],
  });
  // Input tab should still have favIconUrl field (not mutated by sanitizeRemoteCollection)
  expect(inputTab).toEqual(original);
});
