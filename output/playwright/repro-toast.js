const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const extensionPath = path.resolve(process.cwd(), 'build');
  const userDataDir = path.resolve(process.cwd(), 'output/playwright/chromium-profile');
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1440, height: 1000 },
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }

  const extensionId = serviceWorker.url().split('/')[2];
  console.log('EXTENSION_ID', extensionId);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/fullpage.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const fakeUser = {
      displayName: 'Debug User',
      emailAddress: 'debug@example.com',
      photoLink: '',
      syncStatus: 'ok',
    };

    await chrome.storage.local.set({
      theme: 'light',
      googleUser: fakeUser,
      googleRefreshToken: 'debug-token',
      syncSessionState: {
        isEnabled: true,
        status: 'active',
        user: fakeUser,
        hasRefreshToken: true,
        error: null,
        lastCheckedAt: Date.now(),
      },
    });

    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (message, ...rest) => {
      if (message?.type === 'getBackupOptions') return { groups: [] };
      if (message?.type === 'getSyncLogs') return [];
      if (message?.type === 'loadFromServer') return 'no_update_needed';
      if (message?.type === 'getSyncStatus') {
        return {
          displayName: 'Debug User',
          emailAddress: 'debug@example.com',
          photoLink: '',
          syncStatus: 'ok',
        };
      }
      return sendMessage(message, ...rest);
    };
  });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);

  await page.click('.settings-button');
  await page.waitForSelector('.fp-settings-modal-shell');
  await page.getByRole('button', { name: 'Debug and Recovery' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Force Download from Server/i }).click();
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const toaster = document.querySelector('[data-rht-toaster]');
    const toast = document.querySelector('.fp-toast');
    const overlay = document.querySelector('.fp-settings-modal-overlay');
    const shell = document.querySelector('.fp-settings-modal-shell');

    const read = (el) => el ? {
      tag: el.tagName,
      className: el.className,
      text: (el.textContent || '').trim().slice(0, 120),
      zIndex: getComputedStyle(el).zIndex,
      position: getComputedStyle(el).position,
      rect: el.getBoundingClientRect().toJSON(),
    } : null;

    const centerX = window.innerWidth - 80;
    const centerY = window.innerHeight - 80;
    const stack = document.elementsFromPoint(centerX, centerY).slice(0, 10).map((el) => ({
      tag: el.tagName,
      className: el.className,
      text: (el.textContent || '').trim().slice(0, 80),
      zIndex: getComputedStyle(el).zIndex,
      position: getComputedStyle(el).position,
    }));

    return { toaster: read(toaster), toast: read(toast), overlay: read(overlay), shell: read(shell), stack };
  });

  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.resolve(process.cwd(), 'output/playwright/force-sync-toast.png'), fullPage: true });
  await context.close();
})();
