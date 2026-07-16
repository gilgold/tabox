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
