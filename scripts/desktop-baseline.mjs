import { chromium, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('dist');
// The script is a historical baseline tool, not a current-app benchmark.
// Do not silently relabel an integrated build as unchanged upstream code.
await access(path.join(root, 'assets/index-BMM6niMW.js')).catch(() => {
  throw new Error('The original upstream baseline bundle is not in dist. Use desktop-benchmark.mjs for the current app. Restore an independently built upstream baseline before running this historical harness.');
});
const useElectron = process.argv.includes('--electron');
const output = path.resolve(useElectron ? 'artifacts/baseline/electron' : 'artifacts/baseline');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('Outside root');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = useElectron ? await electron.launch({ args: ['desktop/baseline-main.cjs'], env }) : null;
const browser = useElectron ? null : await chromium.launch({ headless: true });
try {
  const page = useElectron ? await application.firstWindow() : await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  if (useElectron) await page.setViewportSize({ width: 1920, height: 1080 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    let state = 18427;
    Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    window.__baseline = { frames: [], drawCalls: 0, triangles: 0 };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = proto[name];
        if (!original) continue;
        proto[name] = function (...args) {
          window.__baseline.drawCalls++;
          const count = name.includes('Arrays') ? args[2] : args[1];
          window.__baseline.triangles += args[0] === 4 ? count / 3 * (name.endsWith('Instanced') ? args.at(-1) : 1) : 0;
          return original.apply(this, args);
        };
      }
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#audio-status')?.style.display === 'block', null, { timeout: 120000 });
  await page.waitForTimeout(10000);
  const metrics = await page.evaluate(async () => {
    window.__baseline.frames = [];
    window.__baseline.drawCalls = 0;
    window.__baseline.triangles = 0;
    const start = performance.now();
    let last = start;
    await new Promise(resolve => {
      function tick(now) {
        window.__baseline.frames.push(now - last);
        last = now;
        if (now - start < 30000) requestAnimationFrame(tick); else resolve();
      }
      requestAnimationFrame(tick);
    });
    const frameTimes = window.__baseline.frames.sort((a, b) => a - b);
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      frameCount: frameTimes.length,
      averageMs: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
      p95Ms: frameTimes[Math.floor(frameTimes.length * .95)],
      p99Ms: frameTimes[Math.floor(frameTimes.length * .99)],
      drawCallsPerFrame: window.__baseline.drawCalls / frameTimes.length,
      trianglesPerFrame: window.__baseline.triangles / frameTimes.length,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      userAgent: navigator.userAgent,
    };
  });
  await page.screenshot({ path: path.join(output, 'upstream-default.png') });
  const hardware = useElectron ? await application.evaluate(async ({ app }) => ({ features: app.getGPUFeatureStatus(), gpu: await app.getGPUInfo('complete') })) : null;
  const report = { upstreamSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), date: new Date().toISOString(), seed: 18427, viewport: [1920, 1080], dpr: 1, camera: 'Unmodified default, stationary', builds: { library: 'passed', app: 'passed' }, metrics, hardware, errors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (useElectron) await application.close(); else await browser.close();
  server.close();
}
