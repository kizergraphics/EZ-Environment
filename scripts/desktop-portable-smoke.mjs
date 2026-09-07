import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const source = path.resolve(process.argv[2] || 'release/EZ-Environment-1.1.0-Portable.exe');
const digest = createHash('sha256');
for await (const chunk of createReadStream(source)) digest.update(chunk);
const executableSha256 = digest.digest('hex');
const sandbox = await mkdtemp(path.join(tmpdir(), 'ez-portable-test-'));
const movedDirectory = path.join(sandbox, 'Moved App');
await mkdir(movedDirectory);
const executable = path.join(movedDirectory, 'EZ Environment.exe');
await copyFile(source, executable);
const output = path.resolve('artifacts/desktop');
await mkdir(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let browser;
const nativeExitCodes = [];

async function launch() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'EZ_ENVIRONMENT_DEV_URL', 'EZ_ENVIRONMENT_DATA_DIR']) delete env[name];
  child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--force-device-scale-factor=1'], { env, windowsHide: true, stdio: 'ignore' });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Portable launcher exited early: ${child.exitCode}`);
    const reachable = await fetch(endpoint + '/json/version').then(r => r.ok).catch(() => false);
    if (reachable) {
      browser = await chromium.connectOverCDP(endpoint);
      const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].waitForEvent('page');
      await page.waitForURL('ez-environment://app/**');
      return page;
    }
    await delay(200);
  }
  throw new Error('Portable app did not expose its local test endpoint within 120 seconds.');
}

async function close() {
  if (!child || child.exitCode !== null) return;
  if (browser) {
    const session = await browser.newBrowserCDPSession();
    // Electron may close its debugger transport before acknowledging Browser.close.
    // Bound protocol cleanup; process exit below is the authoritative close check.
    await Promise.race([session.send('Browser.close').catch(() => {}), delay(1000)]);
    await Promise.race([browser.close().catch(() => {}), delay(1000)]);
    browser = null;
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null) await delay(100);
  if (child.exitCode === null) {
    const pid = child.pid;
    // Limit forced cleanup to the process handle created by this test.
    await new Promise(resolve => {
      const cleanup = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      cleanup.once('exit', resolve); cleanup.once('error', resolve);
    });
    throw new Error(`Portable launcher PID ${pid} did not exit after its window closed; the test process tree was cleaned up.`);
  }
  nativeExitCodes.push(child.exitCode);
}

try {
  let page = await launch();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__ && document.querySelector('canvas'), null, { timeout: 180000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const viewportDifference = await page.evaluate(() => ({ width: innerWidth - document.querySelector('canvas').clientWidth, height: innerHeight - document.querySelector('canvas').clientHeight }));
  await page.setViewportSize({ width: 1920 + viewportDifference.width, height: 1080 + viewportDifference.height });
  const checks = await page.evaluate(async () => {
    localStorage.setItem('portable-smoke-persistence', 'moved-exe');
    const gl = window.__EZ_ENVIRONMENT__.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      origin: location.href, requireType: typeof window.require, processType: typeof window.process,
      bundledModules: [...document.querySelectorAll('script[src]')].map(script => script.src),
      remoteBlocked: await fetch('https://example.com/').then(() => false).catch(() => true),
      localDecoderStatus: await fetch('/draco/draco_decoder.wasm').then(r => r.status),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      dpr: devicePixelRatio,
      resolution: [window.__EZ_ENVIRONMENT__.renderer.domElement.width, window.__EZ_ENVIRONMENT__.renderer.domElement.height],
    };
  });
  assert.equal(checks.requireType, 'undefined');
  assert.equal(checks.processType, 'undefined');
  assert.equal(checks.remoteBlocked, true);
  assert.equal(checks.localDecoderStatus, 200);
  assert.equal(checks.dpr, 1); assert.deepEqual(checks.resolution, [1920, 1080]);
  const modes = [];
  for (const mode of ['plant', 'rock', 'environment', 'tree']) {
    const result = await page.evaluate(async ({mode,benchmark}) => {
      const a = window.__EZ_ENVIRONMENT__;
      await a.studio.setMode(mode);
      if (mode === 'environment') { await a.environment.setOptions({ quality: 'medium', appearance: 'naturalistic' }); a.studio.renderPanel(); }
      a.render();
      const replay = mode === 'environment' && benchmark ? await a.runBenchmark({ duration: 30000, warmup: 10000, replay: true }) : null;
      return { mode: a.mode, generated: ['plant', 'rock'].includes(mode) ? Boolean(a.studio.asset?.definitionHash) : a.environment.ready, environmentVisible:a.environment.visible, latest:a.studio.lastAuthoredMode, previewVisible:a.studio.viewportGroup.visible, assetMode:a.studio.assetMode, drawCalls: a.renderer.info.render.calls, replay };
    }, {mode,benchmark:process.env.EZ_PORTABLE_BENCH!=='0'});
    assert.equal(result.mode, mode);
    assert.equal(result.generated, true);
    assert.equal(result.environmentVisible,true);
    if(mode==='environment'){assert.equal(result.latest,'rock');assert.equal(result.assetMode,'rock');assert.equal(result.previewVisible,true);}
    assert.ok(result.drawCalls > 0);
    if (result.replay) assert.ok(result.replay.frameMs.p95 <= 16.7, `Portable Naturalistic Medium replay frame p95 ${result.replay.frameMs.p95} ms exceeds 16.7 ms.`);
    modes.push(result);
    await page.screenshot({ path: path.join(output, `portable-${mode}.png`) });
  }
  assert.deepEqual(errors, []);
  const biomes=[];
  const catalog=[];
  for(const [mode,expected,ids]of [['plant',27,['moss-cushion','young-pine','fallen-log','short-meadow-grass','tall-seed-grass','saguaro-cactus','agave-rosette']],['rock',22,['limestone-slab','mossy-forest-boulder','talus-scree','sandstone-outcrop']]]){
    await page.evaluate(mode=>window.__EZ_ENVIRONMENT__.studio.setMode(mode),mode);
    const selector=page.locator('#studio-panel select[aria-label="Preset"]');assert.equal(await selector.locator('option').count(),expected+1);
    for(const id of ids){await selector.selectOption(id);await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending);assert.equal(await selector.inputValue(),id);catalog.push({mode,id,hash:await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definitionHash)});}
    console.log(`PASS portable ${mode} catalog (${expected} presets)`);
  }
  await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.setMode('tree'));
  await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.setMode('environment'));
  for(const biome of ['forest','desert','meadow','rocky'])for(const appearance of ['naturalistic','photorealistic']){
    const result=await page.evaluate(async({biome,appearance})=>{
      const a=window.__EZ_ENVIRONMENT__,s=a.studio;await s.applyBiomePreset(biome);await s.envChange({appearance},{modified:false});s.cameraPreset('ground');a.render();
      return{biome:a.environment.options.biome,appearance:a.environment.options.appearance,hash:a.environment.placement.hash,ready:a.environment.ready&&!a.environment.loading,draws:a.renderPipeline.lastDraw.calls};
    },{biome,appearance});
    assert.equal(result.biome,biome);assert.equal(result.appearance,appearance);assert.ok(result.ready&&result.draws>0);
    if(appearance==='photorealistic')assert.equal(result.hash,biomes.at(-1).hash);
    biomes.push(result);console.log(`PASS portable ${biome} ${appearance}`);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'portable.png') });
  await writeFile(path.join(output, 'portable-progress.json'), JSON.stringify({ date: new Date().toISOString(), source, executable, executableSha256, checks, modes, errors, phase: 'first-launch-passed' }, null, 2));
  await close();
  const profile = path.join(movedDirectory, 'EZ Environment Data');
  assert.equal((await stat(profile)).isDirectory(), true, 'Profile should travel beside the moved portable executable.');
  page = await launch();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.evaluate(() => localStorage.getItem('portable-smoke-persistence')), 'moved-exe');
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,null,{timeout:180000});
  await page.getByRole('button',{name:'Restore last workspace',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('studio-status').textContent==='Workspace restored.');
  const restored=await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio;return{mode:s.mode,latest:s.lastAuthoredMode,tree:window.__EZ_ENVIRONMENT__.tree.visible};});
  assert.deepEqual(restored,{mode:'environment',latest:'tree',tree:true});
  await close();
  const report = { date: new Date().toISOString(), source, copiedExecutable: executable, executableSha256, profile, checks, modes, catalog, biomes, errors, nativeExitCodes, persistence: 'Verified across restart from a moved EXE in a path containing spaces.' };
  await writeFile(path.join(output, 'portable-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await close(); }
// A CDP Browser.close can leave Playwright's local dispatcher transport alive
// after Electron has already exited. All writes and native exit checks above
// have completed, so explicitly release only this test runner process.
process.exit(0);
