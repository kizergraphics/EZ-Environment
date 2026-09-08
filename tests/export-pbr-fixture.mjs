import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readGLB, validateMaterialCatalog } from '../src/app/export/material-catalog.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts/export-pbr-fixture');
const url = 'http://127.0.0.1:5194';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.app.config.js', '--host', '127.0.0.1', '--port', '5194', '--strictPort'], { cwd: root, windowsHide: true, stdio: 'pipe' });
let log = '', browser;
server.stdout.on('data', data => log += data);
server.stderr.on('data', data => log += data);
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (server.exitCode !== null) throw new Error(log);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.ready, { timeout: 120000 });
  const download = page.waitForEvent('download', { timeout: 240000 });
  download.catch(() => {});
  const details = await page.evaluate(async () => {
    const { exportScenePack } = await import('/export/exporters.js');
    const app = window.__EZ_ENVIRONMENT__, env = app.environment;
    await env.setOptions({ appearance: 'photorealistic', composition: 'biome' });
    const { generatePlant, createPlantDefinition } = await import('/generators/plants.js');
    const flower = generatePlant(createPlantDefinition('flower'));
    env.registry.set('pbr_flower', flower);
    const ids = ['rock', 'shrub', 'grass', 'fern', 'pbr_flower'];
    const available = ids.filter(id => env.registry.has(id));
    const records = available.flatMap((species, index) => [0,1].map(copy => ({ species, position: [index * 3 - 6, 0, copy * 3], normal: [0,1,0], yaw: .3, scale: [1,1,1], tint: 1, variationSeed: index })));
    const fixture = { ...env, loading: false, exportObjects: [], placement: { chunks: new Map([['0:0', { x: 0, z: 0, layers: { plants: { records } } }]]) } };
    const result = await exportScenePack(fixture, [app.tree], { name: 'pbr-fixture', maxTextureSize: 256 });
    return { assets: result.manifest.assets.length, instances: result.manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0), species: available };
  });
  const zip = path.join(output, 'fixture.zip');
  await (await download).saveAs(zip);
  const files = unzipSync(new Uint8Array(await readFile(zip)));
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  assert.equal(manifest.materialCatalog, 'materials.json');
  const catalog = JSON.parse(new TextDecoder().decode(files[manifest.materialCatalog]));
  assert.ok(validateMaterialCatalog(catalog, new Map(Object.entries(files))));
  assert.ok(catalog.materials.length > 0 && catalog.textures.length > 0);
  const uniqueImages = new Set();
  for (const bytes of Object.entries(files).filter(([file]) => file.endsWith('.glb')).map(([, bytes]) => bytes)) {
    const { json, binary } = readGLB(bytes);
    for (const image of json.images ?? []) {
      const view = json.bufferViews[image.bufferView], start = view.byteOffset ?? 0;
      const embedded = binary.subarray(start, start + view.byteLength);
      const hash = createHash('sha256').update(embedded).digest('hex');
      const file = `textures/${hash}.${image.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
      assert.deepEqual(files[file], embedded, 'companion must match embedded bytes exactly'); uniqueImages.add(file);
    }
  }
  assert.ok(catalog.materials.some(material => material.roughnessTexture));
  const missing = new Map(Object.entries(files)); missing.delete(catalog.textures[0].file);
  assert.throws(() => validateMaterialCatalog(catalog, missing), /Missing/);
  assert.ok(catalog.materials.length < catalog.bindings.reduce((n, binding) => n + binding.materials.length, 0), 'identical LOD materials should be shared');
  let pbrMaterials = 0, maskedMaterials = 0;
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.resolve(output, 'pack', relative);
    assert.ok(target.startsWith(path.join(output, 'pack') + path.sep));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (!relative.endsWith('.glb')) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
    for (const material of gltf.materials ?? []) {
      if (!material.extras?.pbrFamily && relative.includes('flower_white')) continue;
      assert.ok(material.pbrMetallicRoughness?.baseColorTexture, `${relative}: missing color`);
      assert.ok(material.normalTexture, `${relative}: missing normal`);
      assert.ok(material.pbrMetallicRoughness?.metallicRoughnessTexture, `${relative}: missing roughness`);
      pbrMaterials++;
      if (material.alphaMode === 'MASK') maskedMaterials++;
    }
    assert.ok(gltf.images.every(image => image.bufferView !== undefined), `${relative}: image not embedded`);
  }
  assert.ok(pbrMaterials > 10 && maskedMaterials > 0);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ ...details, pbrMaterials, maskedMaterials, sharedMaterials: catalog.materials.length, companionTextures: catalog.textures.length, uniqueEmbeddedImages: uniqueImages.size, errors }, null, 2));
  console.log(JSON.stringify({ output, ...details, pbrMaterials, maskedMaterials }));
} finally { await browser?.close(); server.kill(); }
