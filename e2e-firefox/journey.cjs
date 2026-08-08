#!/usr/bin/env node
'use strict';

// Real-Firefox functional journey test for the Tabox Firefox port.
//
// Extends the boot smoke test (smoke.cjs) with the actual save/restore user
// journey: create a window with a real tab group, save it as a collection
// the way the extension does internally, then restore that collection into
// a fresh window and verify the tab group comes back. This exercises
// Firefox's tabGroups API (including the 'grey' color) and the extension's
// real storage + restore code paths end to end.
//
// Same constraints as smoke.cjs: selenium-webdriver/geckodriver are staged
// by run.sh into a throwaway npm prefix and passed in via NODE_PATH, never
// added to package.json/yarn.lock.
//
// --- How "save the same way the popup does" was interpreted ---
// The popup's "Save Current Tabs" button (app/App.js -> addCollection ->
// app/utils/storageUtils.js#saveSingleCollection) runs entirely inside the
// popup's React/webpack bundle and is not exposed on `window` - there is no
// way to call it from outside that bundle (e.g. from a WebDriver
// executeScript in a normal page context), and it also always targets
// "the current window" relative to wherever the popup happens to be running,
// which would be the wrong window here since we deliberately open the
// journey's tabs in a second, separate window.
//
// Instead this test drives the real *background* message handler that the
// extension already uses for turning an arbitrary tabs/chromeGroups snapshot
// into a persisted collection: `browser.runtime.sendMessage({type:
// 'importData', data: {name, tabs, chromeGroups}})`, which background.js
// routes to `handleSingleCollectionImportBG()` -> `saveSingleCollectionBG()`
// (chrome/background.js / chrome/background-utils.js) - the same
// `collections_index` + `collection_<uid>` storage primitives the popup's
// own save path writes through, just reached via the background's existing
// "single collection" import route rather than reimplementing the write in
// this test. Restoring uses the exact message shape the popup itself sends
// (`{type: 'openTabs', collection, window, newWindow, trackOpenedWindow}`,
// see app/useCollectionOperations.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'build-firefox');
const GECKO_ID = 'tabox@tabox.co';
const FIREFOX_BINARY =
  process.env.FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';
const HEADLESS = process.env.HEADFUL !== '1';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const label = ok ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${name}${detail ? ' - ' + detail : ''}`);
}
function fail(name, detail) {
  record(name, false, detail);
}
function assert(name, condition, detail) {
  record(name, Boolean(condition), detail);
  return Boolean(condition);
}

async function saveEvidence(driver, tag, extra) {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabox-firefox-journey-'));
    const pngPath = path.join(dir, `${tag}.png`);
    const htmlPath = path.join(dir, `${tag}.html`);
    const png = await driver.takeScreenshot();
    fs.writeFileSync(pngPath, Buffer.from(png, 'base64'));
    const source = await driver.getPageSource();
    fs.writeFileSync(htmlPath, source);
    if (extra) {
      const jsonPath = path.join(dir, `${tag}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(extra, null, 2));
      console.error(`  evidence saved: ${jsonPath}`);
    }
    console.error(`  evidence saved: ${pngPath}`);
    console.error(`  evidence saved: ${htmlPath}`);
  } catch (evidenceError) {
    console.error('  (failed to capture evidence)', evidenceError.message);
  }
}

async function main() {
  if (!fs.existsSync(path.join(BUILD_DIR, 'manifest.json'))) {
    fail(
      'build-firefox present',
      `${BUILD_DIR} has no manifest.json - run "yarn build:firefox" first`
    );
    return summarizeAndExit();
  }
  record('build-firefox present', true);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabox-firefox-journey-xpi-'));
  const xpiPath = path.join(workDir, 'tabox.xpi');
  try {
    execFileSync('zip', ['-r', '-X', '-q', xpiPath, '.'], { cwd: BUILD_DIR });
    record('packaged .xpi', true, xpiPath);
  } catch (zipError) {
    fail('packaged .xpi', zipError.message);
    return summarizeAndExit();
  }

  let Builder, firefox, geckodriver;
  try {
    ({ Builder } = require('selenium-webdriver'));
    firefox = require('selenium-webdriver/firefox');
    geckodriver = require('geckodriver');
  } catch (requireError) {
    fail(
      'selenium-webdriver/geckodriver available',
      `${requireError.message} - run via e2e-firefox/run.sh, not "node" directly`
    );
    return summarizeAndExit();
  }

  const gdPath = await geckodriver.download();

  const options = new firefox.Options();
  options.setBinary(FIREFOX_BINARY);
  if (HEADLESS) options.addArguments('-headless');
  options.setPreference('xpinstall.signatures.required', false);

  const service = new firefox.ServiceBuilder(gdPath);

  let driver;
  try {
    driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build();
  } catch (launchError) {
    fail('launch real Firefox', launchError.message);
    return summarizeAndExit();
  }
  record('launch real Firefox', true, FIREFOX_BINARY);

  try {
    const caps = await driver.getCapabilities();
    const profileDir = caps.get('moz:profile');

    await driver.installAddon(xpiPath, /* temporary= */ true);
    record('install temporary add-on', true);

    let uuid = null;
    const prefsPath = path.join(profileDir, 'prefs.js');
    for (let attempt = 0; attempt < 20 && !uuid; attempt++) {
      await driver.sleep(250);
      if (!fs.existsSync(prefsPath)) continue;
      const prefs = fs.readFileSync(prefsPath, 'utf8');
      const escapedId = GECKO_ID.replace(/[.]/g, '\\.');
      const match = prefs.match(
        new RegExp(`extensions\\.webextensions\\.uuids.*${escapedId}\\\\":\\\\"([0-9a-f-]{36})`)
      );
      if (match) uuid = match[1];
    }
    if (!assert('discover extension UUID', uuid, uuid || 'timed out reading prefs.js')) {
      await saveEvidence(driver, 'uuid-discovery-failure');
      return summarizeAndExit();
    }

    // The popup page is our extension-privileged execution context: it has
    // full browser.* API access, same as the real popup.
    await driver.get(`moz-extension://${uuid}/index.html`);
    await driver.sleep(1000);

    const journeyResult = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      const MARKER = 'tabox-e2e-journey-' + Date.now();
      (async () => {
        const out = { marker: MARKER };
        const cleanupWindowIds = [];
        try {
          // --- 1. Second window with 3 tabs, group two of them ---
          const srcWin = await browser.windows.create({
            url: [
              `about:blank?${MARKER}=1`,
              `about:blank?${MARKER}=2`,
              `about:blank?${MARKER}=3`,
            ],
            focused: false,
          });
          cleanupWindowIds.push(srcWin.id);
          await new Promise((r) => setTimeout(r, 500));

          const srcTabs = await browser.tabs.query({ windowId: srcWin.id });
          out.createdTabCount = srcTabs.length;
          const toGroup = srcTabs
            .filter((t) => t.url.endsWith('=2') || t.url.endsWith('=3'))
            .map((t) => t.id);

          const groupId = await browser.tabs.group({
            tabIds: toGroup,
            createProperties: { windowId: srcWin.id },
          });
          await browser.tabGroups.update(groupId, { title: 'smoke-group', color: 'grey' });

          let sourceGroups = [];
          for (let i = 0; i < 10 && sourceGroups.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 200));
            sourceGroups = await browser.tabGroups.query({ windowId: srcWin.id });
          }
          out.sourceGroups = sourceGroups;

          // --- 2. Save as a collection via the same background storage path
          // the extension uses (see file header) ---
          const tabsForSave = await browser.tabs.query({ windowId: srcWin.id });
          const groupsForSave = await browser.tabGroups.query({ windowId: srcWin.id });
          const importResult = await browser.runtime.sendMessage({
            type: 'importData',
            data: {
              name: MARKER,
              tabs: tabsForSave,
              chromeGroups: groupsForSave.filter((g) =>
                tabsForSave.some((t) => t.groupId === g.id)
              ),
            },
          });
          out.importResult = importResult;

          const savedUid = importResult && importResult.firstCollectionUid;
          out.savedUid = savedUid;

          if (savedUid) {
            const storageDump = await browser.storage.local.get([
              'collections_index',
              'collection_' + savedUid,
            ]);
            out.indexEntry = storageDump.collections_index
              ? storageDump.collections_index[savedUid]
              : null;
            out.savedCollection = storageDump['collection_' + savedUid];
          }

          await browser.windows.remove(srcWin.id);
          cleanupWindowIds.pop();

          // --- 3. Restore into a fresh window via the real openTabs message ---
          if (out.savedCollection) {
            const targetWin = await browser.windows.create({ focused: true });
            cleanupWindowIds.push(targetWin.id);
            targetWin.tabs = await browser.tabs.query({ windowId: targetWin.id });

            const openResult = await browser.runtime.sendMessage({
              type: 'openTabs',
              collection: out.savedCollection,
              window: targetWin,
              newWindow: true,
              trackOpenedWindow: false,
            });
            out.openResult = openResult;

            let tabsInTarget = [];
            let groupsInTarget = [];
            for (let i = 0; i < 20; i++) {
              await new Promise((r) => setTimeout(r, 300));
              tabsInTarget = await browser.tabs.query({ windowId: targetWin.id });
              groupsInTarget = await browser.tabGroups.query({ windowId: targetWin.id });
              if (
                groupsInTarget.length > 0 &&
                tabsInTarget.filter((t) => t.url.includes(MARKER)).length >=
                  out.savedCollection.tabs.length
              ) {
                break;
              }
            }
            out.tabsInTarget = tabsInTarget.map((t) => ({ url: t.url, groupId: t.groupId }));
            out.groupsInTarget = groupsInTarget;
          }

          done({ ok: true, out });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e), out });
        } finally {
          for (const id of cleanupWindowIds) {
            try {
              await browser.windows.remove(id);
            } catch (cleanupErr) {
              // best-effort
            }
          }
        }
      })();
    });

    if (!journeyResult || journeyResult.ok !== true) {
      fail('journey script executed without throwing', journeyResult && journeyResult.error);
      await saveEvidence(driver, 'journey-script-exception', journeyResult);
      return summarizeAndExit();
    }

    const out = journeyResult.out;

    // --- Assertions ---
    assert(
      'source window created with 3 tabs',
      out.createdTabCount === 3,
      `createdTabCount=${out.createdTabCount}`
    );

    const sourceGroup = (out.sourceGroups || [])[0];
    assert(
      'two tabs grouped into a grey "smoke-group" (tabGroups API)',
      sourceGroup && sourceGroup.title === 'smoke-group' && sourceGroup.color === 'grey',
      JSON.stringify(sourceGroup)
    );

    const importOk = out.importResult && out.importResult.success === true;
    assert(
      'collection saved via the real importData -> saveSingleCollectionBG path',
      importOk,
      JSON.stringify(out.importResult)
    );

    assert(
      'saved collection in storage has the right tab count (collection_<uid>)',
      out.savedCollection && out.savedCollection.tabs && out.savedCollection.tabs.length === 3,
      `tabs.length=${out.savedCollection && out.savedCollection.tabs && out.savedCollection.tabs.length}`
    );

    const savedGroup = out.savedCollection && (out.savedCollection.chromeGroups || [])[0];
    assert(
      'saved collection has one chromeGroup titled "smoke-group" (collections_index + collection_<uid>)',
      savedGroup && savedGroup.title === 'smoke-group' && savedGroup.color === 'grey' &&
        out.indexEntry && out.indexEntry.tabCount === 3,
      JSON.stringify({ savedGroup, indexEntry: out.indexEntry })
    );

    if (!out.openResult) {
      fail('collection restored into a new window via the real openTabs message', 'no savedCollection to restore - earlier save step failed');
      await saveEvidence(driver, 'journey-restore-skipped', out);
    } else {
      assert(
        'openTabs message reports success restoring all 3 tabs',
        out.openResult.success === true && out.openResult.tabsOpened === 3,
        JSON.stringify(out.openResult)
      );

      const restoredMarkerTabs = (out.tabsInTarget || []).filter((t) =>
        t.url.includes(out.marker)
      );
      assert(
        'all 3 saved tabs are present in the restored window',
        restoredMarkerTabs.length === 3,
        JSON.stringify(out.tabsInTarget)
      );

      const exactTabCountOk = assert(
        'restored window has the expected tab count (3, no extras)',
        (out.tabsInTarget || []).length === 3,
        `tabsInTarget.length=${(out.tabsInTarget || []).length}: ${JSON.stringify(out.tabsInTarget)}`
      );
      if (!exactTabCountOk) {
        console.error(
          '  KNOWN FIREFOX-PORT BUG (not a harness issue): chrome/background.js:975 ' +
          "isNewWindow() only recognizes Chrome's newtab URL shape " +
          '(`url.indexOf(\'://newtab\') > 0`). Firefox\'s default new-window tab is ' +
          '`about:home`/`about:blank` (no "://newtab" substring), so isNewWindow() is ' +
          'always false on Firefox, firstTabUpdate never reuses the blank starter tab, ' +
          'and restoring a collection into a new window leaves one extra blank tab behind.'
        );
        await saveEvidence(driver, 'restored-window-extra-tab', out);
      }

      const restoredGroup = (out.groupsInTarget || [])[0];
      assert(
        'restored window has a tab group titled "smoke-group" with color grey (tabGroups.query)',
        restoredGroup && restoredGroup.title === 'smoke-group' && restoredGroup.color === 'grey',
        JSON.stringify(restoredGroup)
      );
    }
  } finally {
    try {
      await driver.quit();
    } catch (quitError) {
      console.error('(driver quit failed)', quitError.message);
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // non-fatal
    }
  }

  return summarizeAndExit();
}

function summarizeAndExit() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n===== Tabox Firefox journey test summary =====');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  if (failed.length > 0) {
    console.log(`\nFAIL - ${failed.length}/${results.length} check(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nPASS - all ${results.length} check(s) passed.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unhandled error in journey test:', err);
  fail('unhandled exception', err.message);
  summarizeAndExit();
});
