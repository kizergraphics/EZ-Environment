import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/shrub-fix';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.EZ_TEST_URL || 'http://127.0.0.1:5184');
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.ready, null, { timeout: 180000 });
  const report = await page.evaluate(async () => {
    const source = await (await fetch('/generators/plants.js')).text();
    const THREE = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const { PLANT_PRESETS, generatePlant } = await import('/generators/plants.js');
    const { prepareAssetMaterials, assertPbrReady } = await import('/materials/pbr.js');
    const { makeSpecies } = await import('/environment/species.js');
    const { exportGLB } = await import('/export/exporters.js');
    const loaderSource = await (await fetch('/environment/assets.js')).text();
    const { GLTFLoader } = await import(loaderSource.match(/import \{ GLTFLoader \} from "([^"]+)"/)[1]);
    const gallery = document.createElement('div');
    gallery.id = 'shrub-gallery';
    gallery.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#242d2c;display:grid;grid-template-columns:repeat(3,1fr);align-content:start;gap:8px;padding:12px;overflow:auto';
    document.body.append(gallery);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(460, 340); renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#343f3d');
    scene.add(new THREE.HemisphereLight(0xf0f4ff, 0x5a554a, 2));
    const sun = new THREE.DirectionalLight(0xfff4e0, 3); sun.position.set(2, 4, 3); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 460 / 340, .01, 100);
    const records = [];
    const presets = PLANT_PRESETS.filter(p => ['shrub', 'bush', 'sapling', 'coniferSapling'].includes(p.definition.archetype));
    for (const preset of presets) {
      const asset = generatePlant(preset.definition);
      await prepareAssetMaterials(asset);
      for (const lod of asset.lods) assertPbrReady(lod, { requireAll: true });
      const material = asset.object3D.children.find(m => m.userData.materialSlot === 'stems').material;
      if (material.color.getHexString() !== 'ffffff') throw new Error(`${preset.id} has a brown default tint`);
      // Verify the real glTF material, texture images and UVs survive export.
      const exported = [];
      if (['woodland-shrub', 'bush-1', 'bush-2', 'bush-3'].includes(preset.id)) {
        for (const lod of asset.lods) {
          const bytes = await exportGLB(lod);
          const gltf = await new GLTFLoader().parseAsync(bytes, '');
          assertPbrReady(gltf.scene, { requireAll: true });
          const stem = gltf.scene.getObjectByName(`${preset.definition.archetype}_stems`);
          if (stem.material.color.getHexString() !== 'ffffff') throw new Error('Export lost the neutral bark tint');
          let maxV = 0;
          for (let i = 0; i < stem.geometry.attributes.uv.count; i++) maxV = Math.max(maxV, stem.geometry.attributes.uv.getY(i));
          if (maxV <= 3) throw new Error('Export stretched the branch UVs');
          exported.push(bytes.byteLength);
          gltf.scene.traverse(o => { o.geometry?.dispose(); if (o.material) { for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) o.material[slot]?.dispose(); o.material.dispose(); } });
        }
      }
      records.push({ id: preset.id, bark: material.userData.pbrVariant, tint: material.color.getHexString(), lods: asset.lods.length, exported });
      scene.add(asset.object3D);
      const box = new THREE.Box3().setFromObject(asset.object3D), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      camera.position.copy(center).add(new THREE.Vector3(1.1, .65, 1.6).multiplyScalar(extent)); camera.lookAt(center);
      renderer.render(scene, camera);
      const card = document.createElement('div'); card.style.cssText = 'color:#f1f3e8;background:#343f3d;text-align:center;font:16px system-ui;padding-bottom:8px';
      const img = document.createElement('img'); img.src = renderer.domElement.toDataURL(); img.style.width = '100%';
      const label = document.createElement('div'); label.textContent = `${preset.name} · ${preset.definition.barkType}`; card.append(img, label); gallery.append(card);
      if (preset.id === 'woodland-shrub') {
        // Inspect the actual lower stems at close range, with the foliage intact.
        const target = center.clone(); target.y = box.min.y + size.y * .23;
        camera.position.copy(target).add(new THREE.Vector3(.42, .12, .56).multiplyScalar(extent)); camera.lookAt(target);
        renderer.render(scene, camera); window.shrubBarkDetail = renderer.domElement.toDataURL();
      }
      scene.remove(asset.object3D); asset.dispose();
    }
    for (const id of ['shrub', 'bush', 'dry_shrub']) {
      const asset = makeSpecies(id); await prepareAssetMaterials(asset);
      for (const lod of asset.lods) assertPbrReady(lod, { requireAll: true });
      const material = asset.object3D.children[0].material;
      if (material.color.getHexString() !== 'ffffff') throw new Error(`Legacy ${id} has a brown tint`);
      records.push({ id, tint: material.color.getHexString(), bark: material.userData.pbrVariant }); asset.dispose();
    }
    renderer.dispose(); return records;
  });
  await page.locator('#shrub-gallery').screenshot({ path: `${output}/shrub-presets.png` });
  const detail = await page.evaluate(() => window.shrubBarkDetail);
  await writeFile(`${output}/bark-close.png`, Buffer.from(detail.split(',')[1], 'base64'));
  assert.deepEqual(errors, []);
  await writeFile(`${output}/materials-report.json`, JSON.stringify({ report, errors }, null, 2));
  console.log(`PASS ${report.length} woody presets/species; 12 textured GLB LOD round trips; no browser errors.`);
} finally { await browser.close(); }
