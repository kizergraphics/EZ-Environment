// Run only after other rendering tests have released the GPU. No app source hooks.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

assert.equal(process.env.EZ_ALLOW_PORTABLE_DOWNLOAD_TEST, '1', 'Set EZ_ALLOW_PORTABLE_DOWNLOAD_TEST=1 after the isolated GPU tests finish.');
const source = path.resolve(process.argv[2] || 'release/EZ-Environment-1.1.0-Portable.exe');
const scratch = await mkdtemp(path.join(tmpdir(), 'ez-portable-download-'));
const movedDirectory = path.join(scratch, 'Moved App');
const downloadDirectory = path.join(scratch, 'Saved Downloads');
await Promise.all([mkdir(movedDirectory), mkdir(downloadDirectory)]);
const executable = path.join(movedDirectory, 'EZ Environment.exe');
await copyFile(source, executable);
const output = path.resolve('artifacts/desktop');
await mkdir(output, { recursive: true });
const digest = createHash('sha256');
for await (const chunk of createReadStream(executable)) digest.update(chunk);
const report = {
  startedAt: new Date().toISOString(), source, executable,
  executableSha256: digest.digest('hex'), downloadDirectory,
  method: 'Actual moved portable EXE; normal renderer buttons; native Electron will-download interception sets test-only save paths through loopback main-process Inspector.',
  errors: [], downloads: [], passed: false,
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let browser;
let inspector;

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitJson(url, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`Portable launcher exited early: ${child.exitCode}`);
    const value = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Local test endpoint was not ready within ${timeout} ms: ${url}`);
}

async function openInspector(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Main-process inspector closed.')); }
    pending.clear();
  });
  return {
    async evaluate(expression) {
      const result = await new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Main-process Inspector evaluation timed out.')); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() { socket.close(); },
  };
}

async function completedDownload(index, extension) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const records = await inspector.evaluate('globalThis.__EZ_DOWNLOAD_TEST__.records');
    report.downloads = records;
    const entry = records[index];
    if (entry?.state) {
      assert.equal(entry.state, 'completed');
      assert.equal(path.extname(entry.filename), extension);
      assert.equal(path.dirname(entry.savePath), downloadDirectory);
      assert.ok(entry.receivedBytes > 0);
      assert.equal((await stat(entry.savePath)).size, entry.receivedBytes);
      return entry;
    }
    await delay(100);
  }
  throw new Error(`Download ${index} (${extension}) did not complete.`);
}

async function close() {
  inspector?.close(); inspector = null;
  if (browser) {
    const session = await browser.newBrowserCDPSession().catch(() => null);
    if (session) await Promise.race([session.send('Browser.close').catch(() => {}), delay(1000)]);
    await Promise.race([browser.close().catch(() => {}), delay(1000)]);
    browser = null;
  }
  if (!child) return;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null) await delay(100);
  if (child.exitCode === null) {
    report.forcedCleanupPid = child.pid;
    // Only terminate this test's known wrapper process tree, never other apps.
    await new Promise(resolve => {
      const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      cleanup.once('exit', resolve); cleanup.once('error', resolve);
    });
    throw new Error('Portable test process did not close cleanly.');
  }
  report.nativeExitCode = child.exitCode;
  assert.equal(child.exitCode, 0);
}

try {
  const browserPort = await unusedPort();
  let mainPort = await unusedPort();
  while (mainPort === browserPort) mainPort = await unusedPort();
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'EZ_ENVIRONMENT_DEV_URL', 'EZ_ENVIRONMENT_DATA_DIR', 'EZ_ENVIRONMENT_ASSET_ROOT']) delete env[key];
  child = spawn(executable, [
    `--remote-debugging-port=${browserPort}`, '--remote-debugging-address=127.0.0.1',
    `--inspect=127.0.0.1:${mainPort}`, '--force-device-scale-factor=1',
  ], { env, windowsHide: true, stdio: 'ignore' });
  child.once('error', error => report.errors.push(String(error)));
  const endpoint = `http://127.0.0.1:${browserPort}`;
  await waitJson(endpoint + '/json/version');
  const targets = await waitJson(`http://127.0.0.1:${mainPort}/json/list`);
  assert.ok(targets[0]?.webSocketDebuggerUrl, 'Native main-process Inspector is available.');
  inspector = await openInspector(targets[0].webSocketDebuggerUrl);
  report.nativeHook = await inspector.evaluate(`(() => {
    const electron = process.mainModule.require('electron');
    const path = process.mainModule.require('node:path');
    const directory = ${JSON.stringify(downloadDirectory)};
    const state = globalThis.__EZ_DOWNLOAD_TEST__ = { records: [] };
    electron.session.defaultSession.on('will-download', (_event, item) => {
      const filename = path.basename(item.getFilename());
      const record = { filename, savePath: path.join(directory, state.records.length + '-' + filename), startedAt: new Date().toISOString() };
      state.records.push(record);
      item.setSavePath(record.savePath);
      item.once('done', (_event, status) => Object.assign(record, { state: status, actualSavePath: item.getSavePath(), receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), completedAt: new Date().toISOString() }));
    });
    return { isPackaged: electron.app.isPackaged, version: electron.app.getVersion(), exePath: electron.app.getPath('exe'), userData: electron.app.getPath('userData') };
  })()`);
  assert.equal(report.nativeHook.isPackaged, true);
  assert.equal(report.nativeHook.version, '1.1.0');
  assert.equal(report.nativeHook.userData, path.join(movedDirectory, 'EZ Environment Data'));
  browser = await chromium.connectOverCDP(endpoint);
  // Playwright's default context changes Chromium download behavior on attach.
  // Restore native handling so Electron's explicit DownloadItem path is tested.
  const downloadProtocol = await browser.newBrowserCDPSession();
  await downloadProtocol.send('Browser.setDownloadBehavior', { behavior: 'default' });
  await downloadProtocol.detach();
  const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].waitForEvent('page');
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.waitForURL('ez-environment://app/**');
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.studio, null, { timeout: 180000 });
  report.bundledModules = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(script => script.src));
  await page.evaluate(() => window.__EZ_ENVIRONMENT__.studio.setMode('plant'));
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const projectDownload = await completedDownload(0, '.json');
  const projectBytes = await readFile(projectDownload.savePath);
  const project = JSON.parse(projectBytes.toString('utf8'));
  assert.equal(project.format, 'ez-environment-project');
  assert.equal(project.version, 2); assert.equal(project.mode, 'plant');
  assert.ok(project.cameras);
  assert.ok(project.plant?.archetype); assert.ok(project.environment); assert.ok(project.tree);
  report.project = { format: project.format, version: project.version, mode: project.mode, archetype: project.plant.archetype, bytes: projectBytes.length, sha256: createHash('sha256').update(projectBytes).digest('hex') };
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const glbDownload = await completedDownload(1, '.glb');
  const glb = await readFile(glbDownload.savePath);
  assert.ok(glb.length > 20); assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2); assert.equal(glb.readUInt32LE(8), glb.length);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = glb.readUInt32LE(12);
  assert.ok(jsonLength > 0 && 20 + jsonLength <= glb.length);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim());
  assert.equal(gltf.asset.version, '2.0');
  assert.ok(gltf.meshes?.length > 0); assert.ok(gltf.accessors?.length > 0);
  let chunkOffset = 12;
  while (chunkOffset < glb.length) {
    assert.ok(chunkOffset + 8 <= glb.length);
    const chunkLength = glb.readUInt32LE(chunkOffset);
    assert.equal(chunkLength % 4, 0);
    chunkOffset += chunkLength + 8;
    assert.ok(chunkOffset <= glb.length);
  }
  assert.equal(chunkOffset, glb.length);
  report.glb = { version: gltf.asset.version, meshes: gltf.meshes.length, accessors: gltf.accessors.length, bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex') };
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.setMode('environment');await s.envChange({appearance:'photorealistic'},{modified:false});});
  await page.locator('summary').filter({hasText:/^Output$/}).click();
  await page.getByRole('button',{name:'1080p PNG',exact:true}).click();
  const pngDownload=await completedDownload(2,'.png'),png=await readFile(pngDownload.savePath);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);
  report.png={width:1920,height:1080,appearance:'photorealistic',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')};
  assert.equal(report.downloads.length, 3);
  assert.deepEqual(report.errors, []);
  await close();
  report.passed = true;
} catch (error) {
  report.errors.push(String(error.stack || error));
} finally {
  try { await close(); } catch (error) { report.errors.push(String(error)); report.passed = false; }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'download-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
// Native shutdown and report writes are complete; release lingering CDP dispatchers.
process.exit(report.passed ? 0 : 1);
