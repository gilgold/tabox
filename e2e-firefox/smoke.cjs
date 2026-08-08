#!/usr/bin/env node
'use strict';

// Real-Firefox smoke test for the Tabox Firefox port.
//
// Loads build-firefox/ as a temporary WebExtension in an actual Firefox
// binary (via selenium-webdriver + geckodriver, driven over WebDriver
// classic/Marionette) and asserts that:
//   1. the popup page (index.html) boots and the React app renders,
//   2. the full-page view (fullpage.html) boots and renders,
//   3. the background event page is alive and answers a real message.
//
// Playwright cannot load Firefox extensions, which is why this uses
// selenium-webdriver + geckodriver instead. Per project constraints, these
// packages are NOT added to package.json/yarn.lock — see run.sh, which
// installs them into a throwaway prefix and points NODE_PATH at it before
// invoking this script with plain `node`.

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

async function saveEvidence(driver, tag) {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabox-firefox-smoke-'));
    const pngPath = path.join(dir, `${tag}.png`);
    const htmlPath = path.join(dir, `${tag}.html`);
    const png = await driver.takeScreenshot();
    fs.writeFileSync(pngPath, Buffer.from(png, 'base64'));
    const source = await driver.getPageSource();
    fs.writeFileSync(htmlPath, source);
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

  // Package build-firefox/ into a temporary .xpi (zip from inside the dir
  // so manifest.json lands at the archive root, as Firefox requires).
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabox-firefox-xpi-'));
  const xpiPath = path.join(workDir, 'tabox.xpi');
  try {
    execFileSync('zip', ['-r', '-X', '-q', xpiPath, '.'], { cwd: BUILD_DIR });
    record('packaged .xpi', true, xpiPath);
  } catch (zipError) {
    fail('packaged .xpi', zipError.message);
    return summarizeAndExit();
  }

  // selenium-webdriver / geckodriver are provided by run.sh via NODE_PATH,
  // not by this project's package.json - see the file header.
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
  // The build's own build-time signature is dropped; disable the
  // requirement so the temporary install isn't rejected.
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

    // Firefox assigns a per-profile random UUID for moz-extension:// URLs,
    // recorded in the profile's prefs.js under extensions.webextensions.uuids.
    // Poll briefly since the pref write can lag the install by a beat.
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

    // --- Popup (index.html) ---
    try {
      await driver.get(`moz-extension://${uuid}/index.html`);
      await driver.sleep(1500);
      const popupRootLen = await driver.executeScript(
        'return document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1'
      );
      const popupHasApp = await driver.executeScript(
        'return !!document.querySelector(".App")'
      );
      const popupText = await driver.executeScript(
        'return document.body.innerText.slice(0, 500)'
      );
      const popupOk = assert(
        'popup (index.html) renders',
        popupHasApp && popupRootLen > 500,
        `root innerHTML length=${popupRootLen}, .App present=${popupHasApp}`
      );
      if (!popupOk) {
        console.error('  popup body text sample:', JSON.stringify(popupText));
        await saveEvidence(driver, 'popup-render-failure');
      }
    } catch (popupError) {
      fail('popup (index.html) renders', popupError.message);
      await saveEvidence(driver, 'popup-navigation-failure');
    }

    // --- Background alive check (from the popup page's extension context) ---
    try {
      const bgResponse = await driver.executeAsyncScript(function () {
        const callback = arguments[arguments.length - 1];
        browser.runtime.sendMessage({ type: 'checkSyncStatus' }).then(
          (result) => callback({ ok: true, result }),
          (error) => callback({ ok: false, error: String(error) })
        );
      });
      // With no stored Google credentials, background-utils.js resolves
      // this with the literal value `false` - anything else (including a
      // thrown error or hang) means the background event page isn't alive
      // or the message handler isn't wired up.
      assert(
        'background event page alive (checkSyncStatus message)',
        bgResponse && bgResponse.ok && bgResponse.result === false,
        JSON.stringify(bgResponse)
      );
    } catch (bgError) {
      fail('background event page alive (checkSyncStatus message)', bgError.message);
    }

    // --- Full page (fullpage.html) ---
    try {
      await driver.get(`moz-extension://${uuid}/fullpage.html`);
      await driver.sleep(2000);
      const fullpageRootLen = await driver.executeScript(
        'return document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1'
      );
      const fullpageText = await driver.executeScript(
        'return document.body.innerText.slice(0, 500)'
      );
      const fullpageOk = assert(
        'full page (fullpage.html) renders',
        fullpageRootLen > 500 && /Tabox/.test(fullpageText),
        `root innerHTML length=${fullpageRootLen}`
      );
      if (!fullpageOk) {
        console.error('  fullpage body text sample:', JSON.stringify(fullpageText));
        await saveEvidence(driver, 'fullpage-render-failure');
      }
    } catch (fullpageError) {
      fail('full page (fullpage.html) renders', fullpageError.message);
      await saveEvidence(driver, 'fullpage-navigation-failure');
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
  console.log('\n===== Tabox Firefox smoke test summary =====');
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
  console.error('Unhandled error in smoke test:', err);
  fail('unhandled exception', err.message);
  summarizeAndExit();
});
