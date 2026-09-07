import { _electron as electron } from '@playwright/test';
import { cp, copyFile, mkdir, mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = path.resolve('artifacts/performance');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ez-benchmark-'));
const snapshot = path.join(profile, 'built-app');
await cp(path.resolve('dist'), snapshot, { recursive: true });
const env = { ...process.env, EZ_ENVIRONMENT_DATA_DIR: profile, EZ_ENVIRONMENT_ASSET_ROOT: snapshot };
delete env.ELECTRON_RUN_AS_NODE;
delete env.EZ_ENVIRONMENT_DEV_URL;
const soakOnly = process.argv.includes('--soak');
const incrementalOnly = process.argv.includes('--incremental');
const lifecycleOnly = process.argv.includes('--lifecycle');
const drawsOnly = process.argv.includes('--draws');
const gpuBatchOnly = process.argv.includes('--gpu-batch');
const determinismOnly = process.argv.includes('--determinism');
const gpuComponentOnly = process.argv.includes('--gpu-component');
const chunkSize = Number(process.argv.find(a => a.startsWith('--chunk-size='))?.split('=')[1]) || null;
const minutes = Number(process.argv.find(a => a.startsWith('--minutes='))?.split('=')[1] || 30);
const app = await electron.launch({ args: ['desktop/main.cjs', '--force-device-scale-factor=1'], env, timeout: 120000 });
const report = { started: new Date().toISOString(), profile, snapshot, run: soakOnly ? 'soak' : determinismOnly ? 'native-determinism' : gpuComponentOnly ? 'environment-component-gpu' : incrementalOnly ? 'incremental-gpu' : lifecycleOnly ? 'lifecycle' : drawsOnly ? 'draw-attribution' : gpuBatchOnly ? 'gpu-batch' : 'benchmark', reports: [], errors: [] };
report.bundles = await Promise.all((await readdir(path.join(snapshot, 'assets'))).filter(f => f.endsWith('.js')).map(async file => ({ file, sha256: createHash('sha256').update(await readFile(path.join(snapshot, 'assets', file))).digest('hex') })));
const reportPath = path.join(output, soakOnly ? 'soak-report.json' : determinismOnly ? 'native-determinism-report.json' : gpuComponentOnly ? 'environment-component-gpu-report.json' : incrementalOnly ? 'incremental-gpu-report.json' : lifecycleOnly ? 'lifecycle-report.json' : drawsOnly ? 'draw-calls-report.json' : gpuBatchOnly ? 'gpu-batch-report.json' : 'benchmark-report.json');
const history = path.join(output, 'history');
await mkdir(history, { recursive: true });
await copyFile(reportPath, path.join(history, `${new Date().toISOString().replaceAll(':', '-')}-${path.basename(reportPath)}`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
const checkpoint = async () => { await writeFile(reportPath, JSON.stringify(report, null, 2)); };
report.mainProcessLog = [];
app.process().stderr?.on('data', chunk => { report.mainProcessLog.push(String(chunk).slice(-5000)); if (report.mainProcessLog.length > 50) report.mainProcessLog.shift(); });
app.process().on('exit', (code, signal) => { report.processExit = { code, signal, time: new Date().toISOString() }; });
app.on('close', () => { report.appClosed = new Date().toISOString(); });
try {
  const page = await app.firstWindow();
  page.on('crash', () => { report.rendererCrashed = new Date().toISOString(); });
  page.on('close', () => { report.pageClosed = new Date().toISOString(); });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.runBenchmark, null, { timeout: 180000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const diff = await page.evaluate(() => ({ width: innerWidth - document.querySelector('canvas').clientWidth, height: innerHeight - document.querySelector('canvas').clientHeight }));
  await page.setViewportSize({ width: 1920 + diff.width, height: 1080 + diff.height });
  report.hardware = await app.evaluate(async ({ app }) => ({ features: app.getGPUFeatureStatus(), gpu: await app.getGPUInfo('complete') }));
  report.resolution = await page.evaluate(() => [window.__EZ_ENVIRONMENT__.renderer.domElement.width, window.__EZ_ENVIRONMENT__.renderer.domElement.height]);
  assert.deepEqual(report.resolution, [1920, 1080]);
  if (chunkSize) await page.evaluate(chunkSize => window.__EZ_ENVIRONMENT__.environment.setOptions({ chunkSize }), chunkSize);
  report.options = await page.evaluate(() => structuredClone(window.__EZ_ENVIRONMENT__.environment.options));
  await checkpoint();

  if (soakOnly) {
    await page.evaluate(async () => {
      const a = window.__EZ_ENVIRONMENT__; await a.studio.setMode('environment'); await a.environment.setOptions({ quality: 'high' }); a.studio.renderPanel();
      window.__EZ_SOAK_EVENTS__ = [];
      window.__EZ_SOAK_LISTENER__ = event => { if (event.isTrusted) window.__EZ_SOAK_EVENTS__.push({ type: event.type, target: event.target?.tagName, label: event.target?.getAttribute?.('aria-label'), time: performance.now() }); };
      for (const type of ['pointerdown', 'input', 'change', 'keydown']) addEventListener(type, window.__EZ_SOAK_LISTENER__, true);
    });
    report.soakOptions = await page.evaluate(() => structuredClone(window.__EZ_ENVIRONMENT__.environment.options));
    const started = Date.now();
    let sample = 0;
    while (Date.now() - started < minutes * 60000) {
      const result = await page.evaluate(async ({ seed, sample }) => {
        const a = window.__EZ_ENVIRONMENT__;
        const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
        const hash = value => { const text = typeof value === 'string' ? value : canonical(value); let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
        const capture = () => {
          const p = a.environment.placement;
          return { placementHash: p.hash, rawHash: hash([...p.chunks.values()]), optionsHash: hash(a.environment.options), configurationHash: hash({ ...a.environment.options, seed: 0 }), workerOptionsHash: hash(p.options), count: structuredClone(p.count), options: structuredClone(a.environment.options), workerOptions: structuredClone(p.options), generationId: a.environment._generation };
        };
        const before = performance.now();
        await a.environment.setOptions({ seed });
        const generatedMs = performance.now() - before;
        const generation = capture();
        const bench = await a.runBenchmark({ duration: 20000, warmup: 2000, replay: true });
        const afterReplay = capture();
        const consistent = generation.placementHash === generation.rawHash && afterReplay.placementHash === afterReplay.rawHash && generation.placementHash === afterReplay.placementHash && generation.optionsHash === afterReplay.optionsHash && generation.optionsHash === generation.workerOptionsHash && afterReplay.optionsHash === afterReplay.workerOptionsHash;
        return { sample, seed, generatedMs, ...bench, generation, afterReplay, consistent, rawChunksOnMismatch: consistent ? null : structuredClone([...a.environment.placement.chunks.values()]), programs: a.renderer.info.programs.length, registrySize: a.environment.registry.size, batches: a.environment.batches.size, error: a.environment.error?.message || null, jsHeap: performance.memory?.usedJSHeapSize || null };
      }, { seed: 18427 + sample % 20, sample });
      report.reports.push(result);
      result.sameSeedMatches = !report.reports.some(previous => previous !== result && previous.seed === result.seed && previous.placementHash !== result.placementHash);
      if (!result.sameSeedMatches && !result.rawChunksOnMismatch) result.rawChunksOnMismatch = await page.evaluate(() => structuredClone([...window.__EZ_ENVIRONMENT__.environment.placement.chunks.values()]));
      report.elapsedMinutes = (Date.now() - started) / 60000;
      await checkpoint();
      console.log(JSON.stringify({ type: 'soak-checkpoint', sample, elapsedMinutes: report.elapsedMinutes, geometries: result.resources.geometries, textures: result.resources.textures, programs: result.programs, frameP95: result.frameMs.p95, hash: result.placementHash, rawHash: result.afterReplay.rawHash, consistent: result.consistent, sameSeedMatches: result.sameSeedMatches, errors: report.errors.length }));
      sample++;
    }
    const measured = report.reports.slice(5);
    report.interactionEvents = await page.evaluate(() => {
      for (const type of ['pointerdown', 'input', 'change', 'keydown']) removeEventListener(type, window.__EZ_SOAK_LISTENER__, true);
      return window.__EZ_SOAK_EVENTS__;
    });
    const resourceSpread = key => {
      const values = measured.map(r => key === 'programs' ? r.programs : r.resources[key]);
      return values.length ? Math.max(...values) - Math.min(...values) : null;
    };
    const hashes = new Map();
    const repeatedSeedsDeterministic = report.reports.every(r => {
      if (hashes.has(r.seed)) return hashes.get(r.seed) === r.placementHash;
      hashes.set(r.seed, r.placementHash); return true;
    });
    report.summary = {
      requestedMinutes: minutes, elapsedMinutes: report.elapsedMinutes,
      cycles: report.reports.length, warmupCycles: Math.min(5, report.reports.length),
      measuredCycles: measured.length,
      resourceSpread: Object.fromEntries(['geometries', 'textures', 'programs'].map(key => [key, resourceSpread(key)])),
      stableWithinOneResource: measured.length > 0 && ['geometries', 'textures', 'programs'].every(key => resourceSpread(key) <= 1),
      repeatedSeedsDeterministic,
      rawHashesAndOptionsConsistent: report.reports.every(result => result.consistent),
      highQualityThroughout: report.reports.every(result => result.quality === 'high'),
      onlySeedConfigurationChanged: report.reports.every(result => result.generation.configurationHash === report.reports[0].generation.configurationHash && result.afterReplay.configurationHash === report.reports[0].generation.configurationHash),
      worstCycleFrameP95Ms: Math.max(...report.reports.map(r => r.frameMs.p95)),
      environmentErrors: report.reports.filter(r => r.error).map(r => r.error),
    };
    await checkpoint();
    assert.equal(report.summary.highQualityThroughout, true);
    assert.equal(report.summary.onlySeedConfigurationChanged, true, 'Only the seed may change during the controlled High-quality soak.');
    assert.equal(report.summary.rawHashesAndOptionsConsistent, true, 'Immediate/replayed raw records, reported hashes, and worker/controller options must agree.');
    assert.equal(report.summary.repeatedSeedsDeterministic, true);
    assert.deepEqual(report.summary.environmentErrors, []);
    assert.equal(report.summary.stableWithinOneResource, true, 'Renderer resources must remain stable after five warm-up cycles.');
  } else if (determinismOnly) {
    report.scope = 'Fifty sequential changing-seed generations, each followed by a two-second full camera replay. Raw record hashing is deliberately intrusive CPU diagnostics, not frame-time acceptance.';
    await page.evaluate(async () => {
      const a = window.__EZ_ENVIRONMENT__;
      await a.studio.setMode('environment'); await a.environment.setOptions({ quality: 'high' }); a.studio.renderPanel();
      window.__EZ_DETERMINISM_EVENTS__ = [];
      window.__EZ_DETERMINISM_LISTENER__ = event => { if (event.isTrusted) window.__EZ_DETERMINISM_EVENTS__.push({ type: event.type, target: event.target?.tagName, label: event.target?.getAttribute?.('aria-label'), time: performance.now() }); };
      for (const type of ['pointerdown', 'input', 'change', 'keydown']) addEventListener(type, window.__EZ_DETERMINISM_LISTENER__, true);
    });
    const seedHashes = new Map();
    for (let cycle = 0; cycle < 50; cycle++) {
      const result = await page.evaluate(async seed => {
        const a = window.__EZ_ENVIRONMENT__;
        const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
        const hash = value => { const text = typeof value === 'string' ? value : canonical(value); let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
        const capture = () => {
          const p = a.environment.placement;
          return { hash: p.hash, rawHash: hash([...p.chunks.values()]), optionsHash: hash(a.environment.options), workerOptionsHash: hash(p.options), options: structuredClone(a.environment.options), workerOptions: structuredClone(p.options), count: structuredClone(p.count), generationId: a.environment._generation, resources: { ...a.renderer.info.memory, programs: a.renderer.info.programs.length } };
        };
        await a.environment.setOptions({ seed });
        const immediate = capture();
        const replay = await a.runBenchmark({ duration: 2000, warmup: 0, replay: true });
        const after = capture();
        const consistent = immediate.hash === immediate.rawHash && after.hash === after.rawHash && immediate.hash === after.hash && immediate.optionsHash === after.optionsHash && after.optionsHash === after.workerOptionsHash;
        return { seed, immediate, after, consistent, replay, error: a.environment.error?.message || null, rawChunksOnMismatch: consistent ? null : structuredClone([...a.environment.placement.chunks.values()]) };
      }, 18427 + cycle % 20);
      result.cycle = cycle;
      result.sameSeedMatches = !seedHashes.has(result.seed) || seedHashes.get(result.seed) === result.after.hash;
      if (!seedHashes.has(result.seed)) seedHashes.set(result.seed, result.after.hash);
      if (!result.sameSeedMatches && !result.rawChunksOnMismatch) result.rawChunksOnMismatch = await page.evaluate(() => structuredClone([...window.__EZ_ENVIRONMENT__.environment.placement.chunks.values()]));
      report.reports.push(result); await checkpoint();
      console.log(JSON.stringify({ type: 'native-determinism', cycle, seed: result.seed, hash: result.after.hash, rawHash: result.after.rawHash, consistent: result.consistent, sameSeedMatches: result.sameSeedMatches }));
    }
    report.interactionEvents = await page.evaluate(() => {
      for (const type of ['pointerdown', 'input', 'change', 'keydown']) removeEventListener(type, window.__EZ_DETERMINISM_LISTENER__, true);
      return window.__EZ_DETERMINISM_EVENTS__;
    });
    report.passed = report.reports.every(result => result.consistent && result.sameSeedMatches && !result.error);
    await checkpoint(); assert.equal(report.passed, true, 'Immediate/replayed raw records, options, and same-seed hashes must agree.');
  } else if (gpuBatchOnly) {
    await page.evaluate(() => window.__EZ_ENVIRONMENT__.studio.setMode('environment'));
    for (const quality of ['medium', 'high']) {
      await page.evaluate(q => window.__EZ_ENVIRONMENT__.environment.setOptions({ quality: q }), quality);
      const result = await page.evaluate(async () => {
        const a = window.__EZ_ENVIRONMENT__, gl = a.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext) return { supported: false };
        await a.runBenchmark({ duration: 2000, warmup: 3000, replay: false });
        const contentVisible = a.environment.content.visible, groundVisible = a.environment.ground.visible;
        const samples = [], rendersPerBatch = 8;
        try {
          for (let i = 0; i < 24; i++) {
            const visible = i % 2 === 0;
            a.environment.content.visible = visible; a.environment.ground.visible = visible;
            // This microbenchmark intentionally flushes outside the query and
            // repeats a fixed render to amortize desktop-compositor scheduling.
            // Its times are not ordinary application frame times.
            a.render(); gl.finish();
            const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            for (let render = 0; render < rendersPerBatch; render++) a.render();
            gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
            while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 1));
            const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
            const ms = disjoint ? null : gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / rendersPerBatch;
            gl.deleteQuery(q);
            samples.push({ visible, ms, disjoint });
          }
          const summarize = values => { values.sort((a, b) => a - b); return { samples: values.length, medianMs: values[Math.floor(values.length * .5)], averageMs: values.reduce((a, b) => a + b, 0) / values.length, p95Ms: values[Math.floor(values.length * .95)] }; };
          const full = summarize(samples.filter(s => s.visible && s.ms !== null).map(s => s.ms));
          const background = summarize(samples.filter(s => !s.visible && s.ms !== null).map(s => s.ms));
          const deltas = samples.filter((_, i) => i % 2 === 0).map((s, i) => s.ms === null || samples[i * 2 + 1].ms === null ? null : s.ms - samples[i * 2 + 1].ms).filter(v => v !== null);
          return { supported: true, rendersPerBatch, scope: 'Fixed-camera queued-render microbenchmark, terrain+instanced vegetation enabled versus hidden; identical lights, sky, forest, and shadow policy; not frame cadence', full, background, incremental: summarize(deltas), samples };
        } finally { a.environment.content.visible = contentVisible; a.environment.ground.visible = groundVisible; }
      });
      report.reports.push({ quality, ...result }); await checkpoint();
      console.log(JSON.stringify({ type: 'gpu-batch', quality, ...result }));
    }
  } else if (drawsOnly) {
    await page.evaluate(() => window.__EZ_ENVIRONMENT__.studio.setMode('environment'));
    for (const quality of ['medium', 'high']) {
      await page.evaluate(q => window.__EZ_ENVIRONMENT__.environment.setOptions({ quality: q }), quality);
      const result = await page.evaluate(async () => {
        const a = window.__EZ_ENVIRONMENT__, originals = [], samples = [];
        let counters, capture = false;
        const instrument = (object, scope) => {
          if (!object?.isMesh) return;
          for (const [method, suffix] of [['onBeforeRender', 'Main'], ['onBeforeShadow', 'Shadow']]) {
            const original = object[method]; originals.push([object, method, original]);
            object[method] = function (...args) { if (counters) counters[scope + suffix]++; return original?.apply(this, args); };
          }
        };
        a.environment.content.traverse(o => instrument(o, 'content'));
        instrument(a.environment.ground, 'terrain'); instrument(a.environment.skybox, 'sky');
        const originalRender = a.renderer.render;
        a.renderer.render = function (...args) {
          counters = { contentMain: 0, contentShadow: 0, terrainMain: 0, terrainShadow: 0, skyMain: 0, skyShadow: 0 };
          const result = originalRender.apply(this, args);
          if (capture) samples.push({ ...counters, fullScene: a.renderer.info.render.calls });
          return result;
        };
        try {
          await a.runBenchmark({ duration: 2000, warmup: 3000, replay: true });
          await new Promise(r => setTimeout(r, 10000)); capture = true;
          const benchmark = await a.runBenchmark({ duration: 30000, warmup: 0, replay: true }); capture = false;
          const summarize = values => { values.sort((a, b) => a - b); return { average: values.reduce((a, b) => a + b, 0) / values.length, p95: values[Math.floor(values.length * .95)], max: values.at(-1) }; };
          return { benchmark, placement: { chunkSize: a.environment.options.chunkSize, chunks: a.environment.placement.chunks.size, count: a.environment.placement.count, hash: a.environment.placement.hash }, samples: samples.length, content: summarize(samples.map(s => s.contentMain + s.contentShadow)), environment: summarize(samples.map(s => s.contentMain + s.contentShadow + s.terrainMain + s.terrainShadow + s.skyMain + s.skyShadow)), fullScene: summarize(samples.map(s => s.fullScene)), breakdown: Object.fromEntries(Object.keys(samples[0]).map(key => [key, summarize(samples.map(s => s[key]))])) };
        } finally { a.renderer.render = originalRender; for (const [o, key, original] of originals) o[key] = original; }
      });
      report.reports.push({ quality, ...result });
      await checkpoint();
      console.log(JSON.stringify({ type: 'draws', quality, content: result.content, environment: result.environment, fullScene: result.fullScene, breakdown: result.breakdown }));
    }
  } else if (lifecycleOnly) {
    await page.evaluate(() => window.__EZ_ENVIRONMENT__.studio.setMode('environment'));
    for (let cycle = 0; cycle < 25; cycle++) {
      const result = await page.evaluate(async seed => {
        const a = window.__EZ_ENVIRONMENT__, original = a.environment, Constructor = original.constructor;
        const temporary = new Constructor({ ...structuredClone(original.options), seed });
        const started = performance.now();
        const before = { ...a.renderer.info.memory, programs: a.renderer.info.programs.length };
        try {
          await temporary.initialize();
          a.scene.add(temporary); original.visible = false;
          temporary.update(0, a.camera); a.render();
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const initialized = { ...a.renderer.info.memory, programs: a.renderer.info.programs.length };
          await temporary.regenerate(); temporary.update(1, a.camera); a.render();
          const during = { ...a.renderer.info.memory, programs: a.renderer.info.programs.length };
          temporary.dispose(); temporary.dispose(); original.visible = true; a.render();
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { seed, ms: performance.now() - started, before, initialized, during, after: { ...a.renderer.info.memory, programs: a.renderer.info.programs.length }, readyAfterDispose: temporary.ready, registryAfterDispose: temporary.registry.size, batchCountAfterDispose: temporary.batches.size };
        } finally { temporary.dispose(); original.visible = true; }
      }, 28427 + cycle);
      result.cycle = cycle; result.warmup = cycle < 5;
      report.reports.push(result);
      await checkpoint();
      console.log(JSON.stringify({ type: 'lifecycle', ...result }));
    }
    const measured = report.reports.filter(r => !r.warmup);
    report.stableWithinOneResource = ['geometries', 'textures', 'programs'].every(k => Math.max(...measured.map(r => r.after[k])) - Math.min(...measured.map(r => r.after[k])) <= 1);
    report.allDisposed = measured.every(r => !r.readyAfterDispose && r.registryAfterDispose === 0 && r.batchCountAfterDispose === 0);
    report.disposedDuringInitialization = await page.evaluate(async () => {
      const Constructor = window.__EZ_ENVIRONMENT__.environment.constructor, temporary = new Constructor();
      const pending = temporary.initialize();
      const sharedPromise = pending === temporary.initialize();
      const settled = pending.then(() => ({ resolved: true }), error => ({ resolved: false, message: error.message }));
      const deadline = performance.now() + 10000;
      while (!temporary.registry.size && performance.now() < deadline) await new Promise(r => setTimeout(r, 1));
      const stage = { ready: temporary.ready, loading: temporary.loading, registry: temporary.registry.size };
      temporary.dispose(); const result = await settled;
      return { sharedPromise, stage, result, readyAfterDispose: temporary.ready, loadingAfterDispose: temporary.loading, registryAfterDispose: temporary.registry.size, batchesAfterDispose: temporary.batches.size };
    });
    await checkpoint();
    assert.equal(report.disposedDuringInitialization.readyAfterDispose, false, 'Disposal during initialize must not later set ready=true.');
    assert.equal(report.disposedDuringInitialization.result.resolved, false, 'Canceled initialization must reject.');
  } else if (incrementalOnly) {
    await page.evaluate(() => window.__EZ_ENVIRONMENT__.studio.setMode('environment'));
    for (const quality of ['medium', 'high']) {
      await page.evaluate(q => window.__EZ_ENVIRONMENT__.environment.setOptions({ quality: q }), quality);
      const phases = [];
      for (const visible of [true, false, true, false]) {
        const result = await page.evaluate(async visible => {
          const a = window.__EZ_ENVIRONMENT__, gl = a.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          if (!ext) return { supported: false };
          const contentVisible = a.environment.content.visible, groundVisible = a.environment.ground.visible;
          a.environment.content.visible = visible; a.environment.ground.visible = visible;
          await a.runBenchmark({ duration: 2000, warmup: 3000, replay: false });
          const samples = [], pending = [], original = a.renderer.render;
          let disjoint = 0;
          const drain = () => {
            const invalid = gl.getParameter(ext.GPU_DISJOINT_EXT);
            if (invalid) disjoint++;
            for (let i = pending.length - 1; i >= 0; i--) {
              const q = pending[i];
              if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
              if (!invalid) samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
              gl.deleteQuery(q); pending.splice(i, 1);
            }
          };
          a.renderer.render = function (...args) {
            drain();
            if (pending.length > 8 || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return original.apply(this, args);
            const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            try { return original.apply(this, args); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
          };
          try {
            const benchmark = await a.runBenchmark({ duration: 10000, warmup: 0, replay: false });
            drain(); samples.sort((a, b) => a - b);
            return { visible, supported: true, samples: samples.length, disjoint, averageMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: samples[Math.floor(samples.length * .95)], benchmark };
          } finally {
            a.renderer.render = original; pending.forEach(q => gl.deleteQuery(q));
            a.environment.content.visible = contentVisible; a.environment.ground.visible = groundVisible;
          }
        }, visible);
        phases.push(result);
        console.log(JSON.stringify({ type: 'incremental-gpu-phase', quality, visible, averageMs: result.averageMs, p95Ms: result.p95Ms }));
      }
      const average = visible => { const p = phases.filter(p => p.visible === visible && p.supported); return p.length ? p.reduce((sum, p) => sum + p.averageMs, 0) / p.length : null; };
      const full = average(true), background = average(false);
      report.reports.push({ quality, scope: 'Stationary incremental terrain and instanced vegetation GPU cost. Skybox, lights, and scenic forest remain present in both phases. Two alternating on/off pairs, each after 5-second shader warmup and measured for 10 seconds.', phases, fullSceneAverageMs: full, backgroundAverageMs: background, incrementalAverageMs: full !== null && background !== null ? full - background : null });
      await checkpoint();
    }
  } else {
    if (gpuComponentOnly) report.scope = 'Environment component only: hero tree and scenic forest hidden; environment content, terrain, sky, lights, fog, and shadow policy retained. Full circular replay with direct GPU queries; no on/off subtraction and not full-scene timing.';
    for (const mode of gpuComponentOnly ? ['environment'] : ['tree', 'plant', 'rock', 'environment']) {
      await page.evaluate(mode => window.__EZ_ENVIRONMENT__.studio.setMode(mode), mode);
      if (gpuComponentOnly) await page.evaluate(() => { const a = window.__EZ_ENVIRONMENT__; a.tree.visible = false; a.forest.visible = false; });
      const qualities = mode === 'environment' ? (gpuComponentOnly ? ['medium', 'high'] : ['low', 'medium', 'high']) : ['medium'];
      for (const quality of qualities) {
        if (mode === 'environment') await page.evaluate(q => window.__EZ_ENVIRONMENT__.environment.setOptions({ quality: q }), quality);
        const result = await page.evaluate(async ({ replay }) => {
          const a = window.__EZ_ENVIRONMENT__, gl = a.renderer.getContext();
          const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          const samples = [], pending = [];
          let disjointCount = 0;
          let recordAfter = Infinity;
          const original = a.renderer.render;
          const drawSamples = [], drawHooks = [];
          let drawCounts;
          const instrument = (object, scope) => {
            if (!object?.isMesh) return;
            for (const [method, suffix] of [['onBeforeRender', 'Main'], ['onBeforeShadow', 'Shadow']]) {
              const saved = object[method]; drawHooks.push([object, method, saved]);
              object[method] = function (...args) { if (drawCounts) drawCounts[scope + suffix]++; return saved?.apply(this, args); };
            }
          };
          a.environment.content.traverse(object => instrument(object, 'content'));
          instrument(a.environment.ground, 'terrain'); instrument(a.environment.skybox, 'sky');
          const renderCounted = (context, args) => {
            drawCounts = { contentMain: 0, contentShadow: 0, terrainMain: 0, terrainShadow: 0, skyMain: 0, skyShadow: 0 };
            const result = original.apply(context, args);
            if (performance.now() >= recordAfter) drawSamples.push({ ...drawCounts });
            return result;
          };
          const drain = () => {
            const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
            if (disjoint) disjointCount++;
            for (let i = pending.length - 1; i >= 0; i--) {
              const { query: q, record } = pending[i];
              if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
              if (!disjoint && record) samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
              gl.deleteQuery(q); pending.splice(i, 1);
            }
          };
          a.renderer.render = function (...args) {
            if (!ext) return renderCounted(this, args);
            drain();
            if (pending.length >= 8 || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return renderCounted(this, args);
            const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            try { return renderCounted(this, args); }
            finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ query: q, record: performance.now() >= recordAfter }); }
          };
          try {
            // Compile and exercise shaders before recording GPU or CPU samples.
            await a.runBenchmark({ duration: 2000, warmup: 3000, replay });
            samples.length = 0;
            recordAfter = performance.now() + 10000;
            const benchmark = await a.runBenchmark({ duration: 30000, warmup: 10000, replay });
            drain(); samples.sort((a, b) => a - b);
            const summarize = values => { values.sort((a, b) => a - b); return { average: values.reduce((a, b) => a + b, 0) / values.length, p95: values[Math.floor(values.length * .95)], max: values.at(-1) }; };
            const attributedDrawCalls = {
              scope: 'Object-attributed main and shadow passes during the same warmed measurement interval; environment includes terrain and sky, excludes scenic forest.',
              samples: drawSamples.length,
              content: summarize(drawSamples.map(s => s.contentMain + s.contentShadow)),
              environment: summarize(drawSamples.map(s => Object.values(s).reduce((a, b) => a + b, 0))),
              breakdown: Object.fromEntries(Object.keys(drawSamples[0] || {}).map(key => [key, summarize(drawSamples.map(s => s[key]))])),
            };
            return { ...benchmark, attributedDrawCalls, gpu: { supported: !!ext, scope: 'Full renderer.render, including shadow passes', disjointCount, samples: samples.length, averageMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null, p95Ms: samples[Math.floor(samples.length * .95)] ?? null }, programs: a.renderer.info.programs.length };
          } finally {
            a.renderer.render = original;
            for (const [object, method, saved] of drawHooks) object[method] = saved;
            for (const { query } of pending) gl.deleteQuery(query);
          }
        }, { replay: mode === 'environment' });
        result.gates = { frameP95: result.frameMs.p95 <= 16.67, environmentCPU: mode !== 'environment' || result.environmentCPU.p95 <= 1, environmentDrawCalls: mode !== 'environment' || result.attributedDrawCalls.environment.p95 <= 100 };
        if (gpuComponentOnly) { result.gpu.scope = report.scope; result.gates.environmentGPU = result.gpu.supported && result.gpu.p95Ms <= 4; }
        report.reports.push(result);
        // Direct controller options bypass UI event handlers; refresh the panel
        // after timing so screenshots label the measured quality accurately.
        await page.evaluate(() => window.__EZ_ENVIRONMENT__.studio.renderPanel());
        await page.screenshot({ path: path.join(output, `${gpuComponentOnly ? 'component-' : ''}${mode}-${quality}.png`) });
        await checkpoint();
        console.log(JSON.stringify({ type: 'benchmark', ...result }));
      }
    }

    if (!gpuComponentOnly) {
    await page.evaluate(async () => { const a = window.__EZ_ENVIRONMENT__; await a.studio.setMode('environment'); await a.environment.setOptions({ quality: 'high' }); });
    const cycles = [];
    for (let i = 0; i < 25; i++) {
      const result = await page.evaluate(async seed => {
        const a = window.__EZ_ENVIRONMENT__, start = performance.now();
        await a.environment.setOptions({ seed });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { seed, ms: performance.now() - start, ...a.renderer.info.memory, programs: a.renderer.info.programs.length, registrySize: a.environment.registry.size, placementHash: a.environment.placement.hash, error: a.environment.error?.message || null };
      }, 18427 + i);
      if (i >= 5) cycles.push(result);
      console.log(JSON.stringify({ type: 'regeneration', cycle: i, warmup: i < 5, ...result }));
    }
    const spread = key => Math.max(...cycles.map(c => c[key])) - Math.min(...cycles.map(c => c[key]));
    report.regeneration = { warmupCycles: 5, measuredCycles: 20, cycles, spread: { geometries: spread('geometries'), textures: spread('textures'), programs: spread('programs') }, stableWithinOneResource: ['geometries', 'textures', 'programs'].every(k => spread(k) <= 1) };
    await checkpoint();
    console.log(JSON.stringify({ type: 'regeneration-summary', ...report.regeneration }));
    }
  }
  report.completed = new Date().toISOString();
  await checkpoint();
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ type: 'complete', report: reportPath, samples: report.reports.length }));
} finally { await app.close(); await checkpoint(); }
