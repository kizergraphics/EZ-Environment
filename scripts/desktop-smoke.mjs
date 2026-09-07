import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const output = path.resolve('artifacts/desktop');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ez-environment-smoke-'));
const env = { ...process.env, EZ_ENVIRONMENT_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.EZ_ENVIRONMENT_DEV_URL;
const launch = () => electron.launch({ executablePath, args: executablePath ? [] : ['desktop/main.cjs'], env, timeout: 120000 });
let application = await launch();
const errors = [];
const requests = [];
try {
  let page = await application.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => requests.push(request.url()));
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__ && document.querySelector('canvas'), null, { timeout: 180000 });
  const security = await page.evaluate(async () => ({
    origin: location.href,
    requireType: typeof window.require,
    processType: typeof window.process,
    remoteBlocked: await fetch('https://example.com/').then(() => false).catch(() => true),
    fileBlocked: await fetch('file:///C:/Windows/win.ini').then(() => false).catch(() => true),
    localAsset: await fetch('/favicon-32x32.png').then(r => r.status),
  }));
  assert.equal(security.requireType, 'undefined');
  assert.equal(security.processType, 'undefined');
  assert.equal(security.remoteBlocked, true);
  assert.equal(security.fileBlocked, true);
  assert.equal(security.localAsset, 200);
  assert.ok(security.origin.startsWith('ez-environment://app/'));
  await page.evaluate(() => localStorage.setItem('desktop-smoke-persistence', 'portable-profile'));
  const preferences = await application.evaluate(({ BrowserWindow, app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    profile: app.getPath('userData'),
    webPreferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(preferences.webPreferences.contextIsolation, true);
  assert.equal(preferences.webPreferences.sandbox, true);
  assert.equal(preferences.webPreferences.nodeIntegration, false);
  await page.screenshot({ path: path.join(output, executablePath ? 'packaged.png' : 'desktop.png') });
  const remoteRequests = requests.filter(url => /^https?:|^wss?:/.test(url) && url !== 'https://example.com/');
  assert.deepEqual(remoteRequests, [], 'Application startup must not depend on remote assets.');
  assert.deepEqual(errors, [], 'Desktop app must not throw renderer errors.');
  await application.close();
  application = await launch();
  page = await application.firstWindow();
  await page.waitForURL('ez-environment://app/**');
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.evaluate(() => localStorage.getItem('desktop-smoke-persistence')), 'portable-profile');
  const report = { date: new Date().toISOString(), executablePath: executablePath || 'development Electron', security, preferences, remoteRequests, errors, persistence: 'verified across restart' };
  await writeFile(path.join(output, executablePath ? 'packaged-report.json' : 'desktop-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await application.close(); }
