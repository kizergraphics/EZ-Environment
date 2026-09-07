// Release diagnostic only. Do not launch while another GPU test/soak is active.
// Deliberately separate from desktop-benchmark.mjs and its broader-scope reports.
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.env.EZ_ALLOW_GPU_TEST !== '1') throw new Error('Wait for explicit desktop GPU release, then set EZ_ALLOW_GPU_TEST=1.');

const root = path.resolve(import.meta.dirname, '..');
const stamp = new Date().toISOString().replaceAll(':', '-');
const output = path.join(root, 'artifacts', 'performance', 'placed-environment-gpu', stamp);
const reportPath = path.join(output, 'report.json');
const profile = await mkdtemp(path.join(tmpdir(), 'ez-placed-gpu-'));
const snapshot = path.join(profile, 'built-app');
await mkdir(output, { recursive: true });
await cp(path.join(root, 'dist'), snapshot, { recursive: true });
const scope = 'Placed grass, flowers, plants, rocks, boulders, and pebbles, including their main and shadow passes. Hero tree, scenic forest, terrain mesh, sky mesh, and authoring preview are excluded. Skybox material visibility is disabled, retaining its object and descendant lights at their original world transforms. Renderer clear/base-pass overhead, original lighting, fog, and shadow settings remain. This standalone placed-content timing is not marginal full-scene GPU cost and does not replace the prior broader component failure.';
const report = {
  startedAt: new Date().toISOString(), run: 'placed-environment-gpu', scope,
  output, profile, snapshot, reportPath,
  protocol: { seed: 18427, qualities: ['medium', 'high', 'high', 'medium'], warmupMs: 10000, measurementMs: 30000, warmupUsesFullReplay: true, resolution: [1920, 1080], dpr: 1, pendingLimit: 16, finalDrainTimeoutMs: 5000, budgetMsP95: 4,
    cameraReplay: 'Existing app.runBenchmark: x=80*cos(2π*t/duration), z=80*sin(2π*t/duration), y=30+15*sin(π*t/duration), target=(0,5,0). Warm-up and measured intervals each complete the full path.' },
  host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCPUs: cpus().length, ramBytes: totalmem() },
  phases: [], errors: [], consoleErrors: [], trustedInteractions: [],
};
report.bundles = await Promise.all((await readdir(path.join(snapshot, 'assets'))).filter(name => name.endsWith('.js')).map(async file => ({ file, sha256: createHash('sha256').update(await readFile(path.join(snapshot, 'assets', file))).digest('hex') })));
const checkpoint = () => writeFile(reportPath, JSON.stringify(report, null, 2));
await checkpoint();
let app, page;
try {
  const env = { ...process.env, EZ_ENVIRONMENT_DATA_DIR: profile, EZ_ENVIRONMENT_ASSET_ROOT: snapshot };
  delete env.ELECTRON_RUN_AS_NODE; delete env.EZ_ENVIRONMENT_DEV_URL;
  app = await electron.launch({ args: [path.join(root, 'desktop', 'main.cjs'), '--force-device-scale-factor=1'], env, timeout: 120000 });
  app.process().on('exit', (code, signal) => { report.processExit = { code, signal, at: new Date().toISOString() }; });
  page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('crash', () => { report.rendererCrashed = true; });
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.runBenchmark, null, { timeout: 180000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const viewportDifference = await page.evaluate(() => ({ width: innerWidth - document.querySelector('canvas').clientWidth, height: innerHeight - document.querySelector('canvas').clientHeight }));
  await page.setViewportSize({ width: 1920 + viewportDifference.width, height: 1080 + viewportDifference.height });
  report.hardware = await app.evaluate(async ({ app }) => ({ versions: process.versions, features: app.getGPUFeatureStatus(), gpu: await app.getGPUInfo('complete') }));
  const cdp = await page.context().newCDPSession(page); report.browser = await cdp.send('Browser.getVersion'); await cdp.detach();
  report.resolution = await page.evaluate(() => [window.__EZ_ENVIRONMENT__.renderer.domElement.width, window.__EZ_ENVIRONMENT__.renderer.domElement.height]);
  assert.deepEqual(report.resolution, [1920, 1080]);
  await page.evaluate(async () => {
    const a = window.__EZ_ENVIRONMENT__; await a.studio.setMode('environment');
    window.__EZ_PLACED_GPU_INTERACTIONS__ = [];
    for (const type of ['pointerdown', 'input', 'change', 'keydown']) addEventListener(type, event => {
      if (event.isTrusted) window.__EZ_PLACED_GPU_INTERACTIONS__.push({ type, target: event.target?.tagName, label: event.target?.getAttribute?.('aria-label'), at: performance.now() });
    }, true);
  });
  await checkpoint();

  for (const [index, quality] of report.protocol.qualities.entries()) {
    console.log(JSON.stringify({ type: 'phase-start', index, quality, scope: 'placed content only', warmupMs: 10000, measurementMs: 30000 }));
    const result = await page.evaluate(async ({ quality, index, protocol }) => {
      const a = window.__EZ_ENVIRONMENT__, e = a.environment, renderer = a.renderer;
      await e.setOptions({ seed: protocol.seed, quality });
      const optionsBefore = structuredClone(e.options), placementHashBefore = e.placement.hash;
      const original = { render: renderer.render, treeVisible: a.tree.visible, forestVisible: a.forest.visible, groundVisible: e.ground.visible, skyMaterialVisible: e.skybox.material.visible, skyVisible: e.skybox.visible, previewVisible: a.studio.previewRig.visible, viewportVisible: a.studio.viewportGroup.visible, cameraPosition: a.camera.position.clone(), cameraTarget: a.controls.target.clone() };
      const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) return { index, quality, optionsBefore, supported: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable', gates: { gpuBudget: false, measurementValid: false } };
      a.tree.visible = false; a.forest.visible = false; e.ground.visible = false;
      // Skybox is a Mesh AND the parent of the sun/ambient lights. Its parent
      // visibility must remain true so we exclude pixels without changing light.
      e.skybox.visible = true; e.skybox.material.visible = false;
      a.studio.previewRig.visible = false; a.studio.viewportGroup.visible = false;
      const allowed = new Set(); e.content.traverse(o => { if (o.isMesh) allowed.add(o); });
      const summarize = values => {
        if (!values.length || !values.every(Number.isFinite)) return null;
        const sorted = [...values].sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
        return { count: sorted.length, min: sorted[0], average: sorted.reduce((s, n) => s + n, 0) / sorted.length, median: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) };
      };
      const raw = [], pending = [], hooks = [], scopeViolations = [];
      const counters = { issued: 0, completed: 0, skippedCapacity: 0, skippedNested: 0, skippedDisjoint: 0, disjointObservations: 0, disjointRejected: 0, invalidValues: 0, queryCreationFailures: 0, finalDrainPolls: 0, finalDrainCompleted: 0, finalDrainRejected: 0, finalDrainTimedOut: 0, abortedQueries: 0, peakPending: 0 };
      let measuring = false, draining = false, row = null, measuredStart = 0, lastDisjoint = false;
      const drain = () => {
        lastDisjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (lastDisjoint) {
          counters.disjointObservations++;
          // Every outstanding query crossed the invalid timing interval,
          // including ones not yet ready. Never accept those later as valid.
          for (const item of pending.splice(0)) {
            item.row.status = 'rejected-disjoint'; item.row.completedAtMs = performance.now();
            counters.disjointRejected++; if (draining) counters.finalDrainRejected++;
            gl.deleteQuery(item.query);
          }
          return;
        }
        for (let i = pending.length - 1; i >= 0; i--) {
          const item = pending[i]; if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) continue;
          const ms = gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6;
          item.row.gpuMs = ms; item.row.completedAtMs = performance.now();
          if (Number.isFinite(ms) && ms >= 0) { item.row.status = 'completed'; counters.completed++; if (draining) counters.finalDrainCompleted++; }
          else { item.row.status = 'invalid-value'; counters.invalidValues++; }
          gl.deleteQuery(item.query); pending.splice(i, 1);
        }
      };
      const lights = [];
      a.scene.updateMatrixWorld(true);
      a.scene.traverseVisible(o => { if (o.isLight) lights.push({ uuid: o.uuid, type: o.type, color: o.color?.getHex(), intensity: o.intensity, worldMatrix: o.matrixWorld.toArray(), castShadow: o.castShadow, shadow: o.shadow ? { mapSize: o.shadow.mapSize.toArray(), camera: { near: o.shadow.camera.near, far: o.shadow.camera.far, left: o.shadow.camera.left, right: o.shadow.camera.right, top: o.shadow.camera.top, bottom: o.shadow.camera.bottom } } : null }); });
      const renderSettings = { dpr: renderer.getPixelRatio(), width: renderer.domElement.width, height: renderer.domElement.height, shadowEnabled: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, shadowAutoUpdate: renderer.shadowMap.autoUpdate, antialias: gl.getContextAttributes().antialias, toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure, fog: a.scene.fog ? { type: a.scene.fog.type || a.scene.fog.constructor.name, color: a.scene.fog.color.getHex(), density: a.scene.fog.density } : null, lights };
      let warmupBenchmark, measuredBenchmark, drainMs = 0, phaseError = null;
      try {
        // Warm every camera/LOD angle using the SAME replay, with no GPU samples
        // accepted until this ten-second warm-up is fully finished.
        warmupBenchmark = await a.runBenchmark({ duration: protocol.warmupMs, warmup: 0, replay: true });
        a.camera.position.set(80, 30, 0); a.controls.target.set(0, 5, 0); a.controls.update();
        a.scene.traverse(o => {
          if (!o.isMesh) return;
          for (const [key, pass] of [['onBeforeRender', 'main'], ['onBeforeShadow', 'shadow']]) {
            const saved = o[key]; hooks.push([o, key, saved]);
            o[key] = function (...args) {
              if (row) {
                row.draws[pass]++;
                if (!allowed.has(o)) { row.unexpectedDraws++; if (scopeViolations.length < 100) scopeViolations.push({ name: o.name, uuid: o.uuid, pass, at: performance.now() }); }
              }
              return saved?.apply(this, args);
            };
          }
        });
        renderer.render = function (...args) {
          drain();
          if (!measuring) return original.render.apply(this, args);
          const started = performance.now();
          row = { frame: raw.length, atMs: started, epochMs: performance.timeOrigin + started, elapsedMs: started - measuredStart, camera: a.camera.position.toArray(), quaternion: a.camera.quaternion.toArray(), target: a.controls.target.toArray(), windTime: e.wind.uniforms?.time?.value ?? null, status: 'pending', gpuMs: null, draws: { main: 0, shadow: 0 }, unexpectedDraws: 0 };
          const currentRow = row; raw.push(currentRow); let query = null;
          if (lastDisjoint) { currentRow.status = 'skipped-disjoint'; counters.skippedDisjoint++; }
          else if (pending.length >= protocol.pendingLimit) { currentRow.status = 'skipped-capacity'; counters.skippedCapacity++; }
          else if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { currentRow.status = 'skipped-nested'; counters.skippedNested++; }
          else {
            query = gl.createQuery();
            if (query) { gl.beginQuery(ext.TIME_ELAPSED_EXT, query); counters.issued++; }
            else { currentRow.status = 'query-creation-failed'; counters.queryCreationFailures++; }
          }
          try { return original.render.apply(this, args); }
          finally {
            if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ query, row: currentRow }); counters.peakPending = Math.max(counters.peakPending, pending.length); }
            currentRow.renderSubmitMs = performance.now() - started;
            currentRow.renderTriangles = renderer.info.render.triangles; row = null;
          }
        };
        measuredStart = performance.now(); measuring = true;
        measuredBenchmark = await a.runBenchmark({ duration: protocol.measurementMs, warmup: 0, replay: true });
        measuring = false; draining = true;
        const drainStart = performance.now(), deadline = drainStart + protocol.finalDrainTimeoutMs;
        gl.flush();
        while (pending.length && performance.now() < deadline) { counters.finalDrainPolls++; drain(); if (pending.length) await new Promise(resolve => setTimeout(resolve, 5)); }
        drain(); drainMs = performance.now() - drainStart;
        for (const item of pending.splice(0)) { item.row.status = 'drain-timeout'; item.row.completedAtMs = performance.now(); counters.finalDrainTimedOut++; gl.deleteQuery(item.query); }
        draining = false;
      } catch (error) {
        phaseError = error.stack || error.message;
      } finally {
        measuring = false; row = null; renderer.render = original.render;
        for (const [object, key, saved] of hooks) object[key] = saved;
        for (const item of pending.splice(0)) { item.row.status = 'phase-aborted'; counters.abortedQueries++; gl.deleteQuery(item.query); }
        a.tree.visible = original.treeVisible; a.forest.visible = original.forestVisible; e.ground.visible = original.groundVisible;
        e.skybox.material.visible = original.skyMaterialVisible; e.skybox.visible = original.skyVisible;
        a.studio.previewRig.visible = original.previewVisible; a.studio.viewportGroup.visible = original.viewportVisible;
        a.camera.position.copy(original.cameraPosition); a.controls.target.copy(original.cameraTarget); a.controls.update();
      }
      const optionsAfter = structuredClone(e.options), placementHashAfter = e.placement.hash;
      const gpu = summarize(raw.filter(r => r.status === 'completed').map(r => r.gpuMs));
      const coverage = raw.length ? counters.completed / raw.length : 0;
      // A skipped slow/backlogged frame must not silently improve the p95.
      // Preserve it in raw data, but require complete sampling to certify a pass.
      const samplingValid = !phaseError && !!gpu && coverage === 1 && counters.disjointObservations === 0 && counters.invalidValues === 0 && counters.queryCreationFailures === 0 && counters.finalDrainTimedOut === 0 && counters.abortedQueries === 0;
      const optionsStable = JSON.stringify(optionsBefore) === JSON.stringify(optionsAfter) && placementHashBefore === placementHashAfter;
      const resolutionCorrect = renderSettings.width === 1920 && renderSettings.height === 1080 && renderSettings.dpr === 1;
      return { index, quality, supported: true, phaseError, optionsBefore, optionsAfter, placementHashBefore, placementHashAfter, renderSettings, warmupBenchmark, measuredBenchmark, gpu, coverage, counters, drainMs, raw, scopeViolations, trustedInteractions: [...window.__EZ_PLACED_GPU_INTERACTIONS__], gates: { gpuBudget: !!gpu && Number.isFinite(gpu.p95) && gpu.p95 <= protocol.budgetMsP95, measurementValid: samplingValid && optionsStable && resolutionCorrect && scopeViolations.length === 0 && window.__EZ_PLACED_GPU_INTERACTIONS__.length === 0, optionsStable, resolutionCorrect, scopeValid: scopeViolations.length === 0 } };
    }, { quality, index, protocol: report.protocol });
    const rawPath = path.join(output, `${index}-${quality}-raw.json`);
    await writeFile(rawPath, JSON.stringify({ index, quality, scope, raw: result.raw || [] }));
    delete result.raw; result.rawPath = rawPath;
    report.phases.push(result); report.trustedInteractions = result.trustedInteractions || report.trustedInteractions;
    await checkpoint();
    console.log(JSON.stringify({ type: 'phase-complete', index, quality, gpu: result.gpu, coverage: result.coverage, counters: result.counters, gates: result.gates, rawPath }));
    if (!result.supported) throw new Error(result.reason);
    if (result.phaseError) throw new Error(result.phaseError);
  }
  report.passed = report.phases.length === 4 && report.phases.every(p => p.gates.gpuBudget && p.gates.measurementValid) && !report.errors.length && !report.consoleErrors.length && !report.rendererCrashed;
  await checkpoint();
  assert.equal(report.passed, true, 'Placed-environment GPU budget or measurement validity failed; retain raw evidence and phase gates.');
} catch (error) {
  report.passed = false; report.failure = error.stack || error.message; process.exitCode = 1;
  console.error(report.failure);
} finally {
  await app?.close(); report.finishedAt = new Date().toISOString(); await checkpoint();
  console.log(JSON.stringify({ type: 'complete', passed: report.passed, reportPath }));
}
