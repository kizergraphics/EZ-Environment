import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
const root = path.resolve(import.meta.dirname, '..'),
  output = path.join(root, 'artifacts', 'export-scene-fixture');
const url = 'http://127.0.0.1:5191';
await mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    '--config',
    'vite.app.config.js',
    '--host',
    '127.0.0.1',
    '--port',
    '5191',
    '--strictPort',
  ],
  { cwd: root, windowsHide: true, stdio: 'pipe' },
);
let serverLog = '';
server.stdout.on('data', (data) => (serverLog += data));
server.stderr.on('data', (data) => (serverLog += data));
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.ready, {
    timeout: 90000,
  });
  const download = page.waitForEvent('download', { timeout: 180000 });
  const details = await page.evaluate(async () => {
    const { exportScenePack } = await import('/export/exporters.js');
    const { hash } = await import('/environment/random.js');
    const app = window.__EZ_ENVIRONMENT__,
      source = app.environment,
      placement = structuredClone(source.placement);
    for (const chunk of placement.chunks.values())
      for (const layer of Object.values(chunk.layers))
        layer.records = layer.records.slice(0, 1);
    const plantChunk = [...placement.chunks.values()].find(
      (chunk) => chunk.layers.plants.records.length,
    );
    const fern = structuredClone(plantChunk.layers.plants.records[0]);
    fern.species = 'fern';
    fern.position[0] += 0.4;
    plantChunk.layers.plants.records.push(fern);
    const flowerChunk = [...placement.chunks.values()].find(
      (chunk) => chunk.layers.flowers.records.length,
    );
    const flower = structuredClone(flowerChunk.layers.flowers.records[0]);
    flower.species = 'flower_white';
    flower.position[0] += 0.5;
    flowerChunk.layers.flowers.records.push(flower);
    placement.hash = hash([...placement.chunks.values()]);
    const fixture = { ...source, placement, loading: false, exportObjects: [] };
    const result = await exportScenePack(
      fixture,
      [app.tree, ...app.forest.children],
      { name: 'scene-fixture', treeColliders: true },
    );
    return {
      assets: result.manifest.assets.length,
      trees: result.manifest.assets.filter((asset) =>
        asset.id.startsWith('tree-'),
      ).length,
      chunks: result.manifest.chunks.length,
      instances: result.manifest.chunks.reduce(
        (sum, chunk) => sum + chunk.count,
        0,
      ),
      files: result.manifest.files.length,
    };
  });
  const zip = path.join(output, 'scene-fixture.zip');
  await (await download).saveAs(zip);
  const files = unzipSync(new Uint8Array(await readFile(zip)));
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.resolve(output, 'pack', relative);
    assert.ok(target.startsWith(path.join(output, 'pack') + path.sep));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ ...details, errors }, null, 2),
  );
  console.log(JSON.stringify({ output, ...details }));
} finally {
  await browser?.close();
  server.kill();
}
