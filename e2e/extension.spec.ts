import { chromium, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

function installedChromiumExecutable(): string | undefined {
  const expected = chromium.executablePath();
  if (existsSync(expected)) return expected;
  const regular = expected
    .replace('chromium_headless_shell-', 'chromium-')
    .replace('chrome-headless-shell-win64', 'chrome-win64')
    .replace('chrome-headless-shell.exe', 'chrome.exe');
  return existsSync(regular) ? regular : undefined;
}

test('the built MV3 side panel loads and exposes all product areas', async ({}, testInfo) => {
  const extensionPath = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    headless: true,
    executablePath: installedChromiumExecutable(),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(page.getByText('Rerunly', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('What should Rerunly do?')).toBeVisible();
    const sections = [
      ['Tasks', 'Saved tasks'],
      ['Vault', 'Protected values'],
      ['History', 'Run history'],
      ['Settings', 'Provider settings'],
      ['Chat', 'What should Rerunly do?']
    ] as const;
    for (const [button, heading] of sections) {
      await page.getByRole('button', { name: button }).click();
      await expect(page.getByText(heading, { exact: true })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath('sidepanel.png'), fullPage: true });
  } finally {
    await context.close();
  }
});
