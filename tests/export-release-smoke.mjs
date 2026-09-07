// Deliberately manual: run only after native performance/soak testing releases
// the GPU. This serves immutable dist/ and exercises its real export button.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts', 'export-release-smoke');
const url = 'http://127.0.0.1:5191';
const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
const bundle = html.match(/src="\/assets\/(index-[^"]+\.js)"/)?.[1];
assert.ok(bundle, 'Build the application before running release export smoke.');
const expected = process.argv
  .find((arg) => arg.startsWith('--expected-bundle='))
  ?.split('=')[1];
if (expected)
  assert.equal(
    bundle,
    expected,
    'The built bundle differs from the requested release.',
  );
const bundleSHA256 = createHash('sha256')
  .update(await readFile(path.join(root, 'dist', 'assets', bundle)))
  .digest('hex');
await mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'preview',
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
let serverLog = '',
  browser;
server.stdout.on('data', (data) => (serverLog += data));
server.stderr.on('data', (data) => (serverLog += data));
try {
  for (let attempt = 0; attempt < 80; attempt++) {
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
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.ready, null, {
    timeout: 90000,
  });
  const served = await page
    .locator('script[type="module"]')
    .getAttribute('src');
  assert.equal(served, `/assets/${bundle}`);
  const before = await page.evaluate(async () => {
    const app = window.__EZ_ENVIRONMENT__,
      environment = app.environment;
    const placement = structuredClone(environment.placement);
    for (const chunk of placement.chunks.values())
      for (const layer of Object.values(chunk.layers))
        layer.records = layer.records.slice(0, 1);
    const plantChunk = [...placement.chunks.values()].find(
      (chunk) => chunk.layers.plants.records.length,
    );
    const flowerChunk = [...placement.chunks.values()].find(
      (chunk) => chunk.layers.flowers.records.length,
    );
    if (!plantChunk || !flowerChunk)
      throw new Error('Release fixture needs default plants and flowers.');
    const fern = structuredClone(plantChunk.layers.plants.records[0]);
    fern.species = 'fern';
    fern.position[0] += 0.4;
    plantChunk.layers.plants.records.push(fern);
    const flower = structuredClone(flowerChunk.layers.flowers.records[0]);
    flower.species = 'flower_white';
    flower.position[0] += 0.5;
    flowerChunk.layers.flowers.records.push(flower);
    environment.placement = placement;
    const grass = environment.registry.get('grass'),
      grassMaterials = [];
    for (const lod of grass.lods)
      lod.traverse((object) => {
        if (object.material) grassMaterials.push(object.material);
      });
    const savedMaterials = [
      ...new Set([
        ...grassMaterials,
        app.tree.branchesMesh.material,
        environment.ground.material,
      ]),
    ].map((material) => ({
      material,
      color: material.color.clone(),
      roughness: material.roughness,
    }));
    const before = {
      grassColor: grassMaterials[0].color.toArray(),
      grassRoughness: grassMaterials[0].roughness,
      heroSeed: app.tree.options.seed,
      heroColor: app.tree.branchesMesh.material.color.toArray(),
      terrainColor: environment.ground.material.color.toArray(),
    };
    window.__EXPORT_RELEASE_SMOKE__ = { mutated: false, savedMaterials };
    app.studio.exportOptions = {
      maxTextureSize: 1024,
      includeInstancedScene: false,
      includeBakedChunks: false,
      onProgress() {
        const proof = window.__EXPORT_RELEASE_SMOKE__;
        if (proof.mutated) return;
        proof.mutated = true;
        for (const entry of proof.savedMaterials) {
          entry.material.color.set('#ff0000');
          entry.material.roughness = 0.13;
        }
      },
    };
    await app.studio.setMode('environment');
    return before;
  });
  const download = page.waitForEvent('download', { timeout: 240000 });
  await page
    .getByRole('button', { name: 'Export environment pack', exact: true })
    .click();
  const zip = path.join(output, 'scene-fixture.zip');
  await (await download).saveAs(zip);
  const mutated = await page.evaluate(() => {
    const proof = window.__EXPORT_RELEASE_SMOKE__;
    for (const entry of proof.savedMaterials) {
      entry.material.color.copy(entry.color);
      entry.material.roughness = entry.roughness;
    }
    return proof.mutated;
  });
  assert.equal(
    mutated,
    true,
    'Appearance edits must occur during the actual export.',
  );
  const files = unzipSync(new Uint8Array(await readFile(zip)));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  const jsonFor = (file) => {
    const bytes = Buffer.from(files[file]);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  };
  const textureImage = (json, texture) =>
    json.images[json.textures[texture.index].source];
  const trees = manifest.assets.filter((asset) => asset.id.startsWith('tree-'));
  assert.equal(trees.length, 25);
  const flower = manifest.assets.find((asset) => asset.id === 'flower_white'),
    shrub = manifest.assets.find((asset) => asset.id === 'shrub'),
    grass = manifest.assets.find((asset) => asset.id === 'grass');
  assert.ok(flower && shrub && grass);
  assert.deepEqual(flower.wind, { enabled: true, attribute: null });
  assert.deepEqual(shrub.wind, { enabled: true, attribute: '_WINDWEIGHT' });
  let jpegImages = 0,
    alphaPNGImages = 0;
  for (const asset of trees) {
    assert.deepEqual(asset.wind, { enabled: true, attribute: null });
    for (const lod of asset.lods) {
      const json = jsonFor(lod.file);
      assert.ok(
        json.meshes.every((mesh) =>
          mesh.primitives.every(
            (primitive) => !('_WINDWEIGHT' in primitive.attributes),
          ),
        ),
      );
      for (const material of json.materials) {
        const color = material.pbrMetallicRoughness.baseColorTexture;
        if (color && ['MASK', 'BLEND'].includes(material.alphaMode)) {
          assert.equal(textureImage(json, color).mimeType, 'image/png');
          alphaPNGImages++;
        } else if (color) {
          assert.equal(textureImage(json, color).mimeType, 'image/jpeg');
          jpegImages++;
        }
        if (material.normalTexture) {
          assert.equal(
            textureImage(json, material.normalTexture).mimeType,
            'image/jpeg',
          );
          jpegImages++;
        }
        const packed = material.pbrMetallicRoughness.metallicRoughnessTexture;
        if (packed)
          assert.equal(textureImage(json, packed).mimeType, 'image/png');
      }
    }
  }
  assert.ok(jpegImages > 0 && alphaPNGImages > 0);
  for (const lod of shrub.lods)
    assert.ok(
      jsonFor(lod.file).meshes.some((mesh) =>
        mesh.primitives.some(
          (primitive) => '_WINDWEIGHT' in primitive.attributes,
        ),
      ),
    );
  for (const lod of grass.lods) {
    const material = jsonFor(lod.file).materials[0].pbrMetallicRoughness;
    assert.deepEqual(material.baseColorFactor, [...before.grassColor, 1]);
    assert.equal(material.roughnessFactor, before.grassRoughness);
  }
  const hero = trees.find(
    (asset) =>
      JSON.parse(strFromU8(files[asset.preset])).seed === before.heroSeed,
  );
  assert.ok(hero);
  for (const lod of hero.lods) {
    const json = jsonFor(lod.file),
      node = json.nodes.find((node) => node.name === 'Branches');
    assert.ok(node);
    const branch = json.meshes[node.mesh];
    assert.deepEqual(
      json.materials[branch.primitives[0].material].pbrMetallicRoughness
        .baseColorFactor ?? [1, 1, 1, 1],
      [...before.heroColor, 1],
    );
  }
  assert.deepEqual(
    jsonFor('terrain.glb').materials[0].pbrMetallicRoughness
      .baseColorFactor ?? [1, 1, 1, 1],
    [...before.terrainColor, 1],
  );
  const zipBytes = (await stat(zip)).size;
  assert.ok(
    zipBytes < 300_000_000,
    `JPEG-preserving fixture unexpectedly large: ${zipBytes}`,
  );
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.resolve(output, 'pack', relative);
    assert.ok(target.startsWith(path.join(output, 'pack') + path.sep));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    bundle,
    bundleSHA256,
    zipBytes,
    assets: manifest.assets.length,
    trees: trees.length,
    chunks: manifest.chunks.length,
    instances: manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0),
    files: manifest.files.length,
    jpegImages,
    alphaPNGImages,
    appearanceSnapshotVerified: true,
    windMetadataVerified: true,
    errors,
  };
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ output, ...report }));
} finally {
  await browser?.close();
  server.kill();
}
