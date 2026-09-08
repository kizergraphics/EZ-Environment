import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('artifacts/pbr-authoring');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(120000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.EZ_TEST_URL || 'http://127.0.0.1:5194');
  await page.waitForFunction(() => window.__EZ_ENVIRONMENT__?.ready);
  const coverage = await page.evaluate(async () => {
    const plants = await import('/generators/plants.js'), rocks = await import('/generators/rocks.js');
    const { prepareAssetMaterials, assertPbrReady } = await import('/materials/pbr.js');
    const result = [];
    for (const [types, create, generate] of [[plants.PLANT_ARCHETYPES, plants.createPlantDefinition, plants.generatePlant], [rocks.ROCK_ARCHETYPES, rocks.createRockDefinition, rocks.generateRock]]) {
      for (const type of types) {
        const asset = generate(create(type));
        try { await prepareAssetMaterials(asset); for (const lod of asset.lods) assertPbrReady(lod, {requireAll:true}); result.push(type); }
        finally { asset.dispose(); }
      }
    }
    return result;
  });
  checks.push({ allGeneratorMaterialCoverage: coverage });
  for (const [mode, archetype] of [['rock', 'rock'], ['plant', 'flower'], ['plant', 'fern']]) {
    const result = await page.evaluate(async ({ mode, archetype }) => {
      const studio = window.__EZ_ENVIRONMENT__.studio;
      await studio.setMode(mode);
      const generators = await import(`/generators/${mode === 'rock' ? 'rocks' : 'plants'}.js`);
      studio.definitions[mode] = mode === 'rock' ? generators.createRockDefinition(archetype) : generators.createPlantDefinition(archetype);
      await studio.generate(true);
      studio.renderPanel();
      const materials = studio.asset.lods.map(lod => {
        const result = [];
        lod.traverse(mesh => {
          if (!mesh.isMesh) return;
          const m = mesh.material;
          result.push({ name: m.name, family: m.userData.pbrFamily, maps: ['map', 'normalMap', 'roughnessMap'].map(key => !!m[key]?.image), uv: !!mesh.geometry.attributes.uv });
        });
        return result;
      });
      await new Promise(requestAnimationFrame);
      return materials;
    }, { mode, archetype });
    assert.equal(result.length, 3);
    assert.ok(result.every(lod => lod.length && lod.every(m => m.family && m.uv && m.maps.every(Boolean))), JSON.stringify({archetype,result}));
    checks.push({ archetype, materials: result });
    await page.screenshot({ path: path.join(output, `${archetype}.png`) });
  }
  // Inspect the application tree and verify independently scaled bark templates.
  const treeMaps = await page.evaluate(async () => {
    const app = window.__EZ_ENVIRONMENT__;
    await app.studio.setMode('tree');
    const material = app.tree.leavesMesh.material;
    const { cleanTreeDefinition } = await import('/studio/tree-project.js');
    const saved = cleanTreeDefinition(app.tree);
    const { applyTreeTextures } = await import('/textures.js');
    const { disposeObject } = await import('/environment/assets.js');
    const first = new app.tree.constructor(), second = new app.tree.constructor();
    for (const tree of [first, second]) { tree.options.branch.levels = 0; tree.options.leaves.count = 0; applyTreeTextures(tree); }
    first.options.bark.textureScale.y = 2; first.generate();
    second.options.bark.textureScale.y = 4; second.generate();
    const scales = [first.branchesMesh.material.map.repeat.y, second.branchesMesh.material.map.repeat.y];
    disposeObject(first); disposeObject(second);
    return { maps: ['map', 'normalMap', 'roughnessMap'].map(key => !!material[key]?.image), saved: JSON.stringify(saved).includes('isTexture'), extraMaps: ['map','normalMap','roughnessMap'].some(key => key in saved.leaves), scales };
  });
  assert.ok(treeMaps.maps.every(Boolean));
  assert.equal(treeMaps.saved, false);
  assert.equal(treeMaps.extraMaps, false);
  assert.deepEqual(treeMaps.scales, [.5, .25]);
  checks.push({ treeMaps });
  const restored = await page.evaluate(async () => {
    const app = window.__EZ_ENVIRONMENT__;
    const { makeSpecies } = await import('/environment/species.js');
    const { createPlantDefinition } = await import('/generators/plants.js');
    const asset = makeSpecies('flower', createPlantDefinition('flower', { seed: 937 }));
    await app.environment.addSpecies('pbr_restore_fixture', asset, 'flowers');
    const project = app.studio.project();
    await app.studio.loadProject(project);
    const result = [];
    for (const lod of app.environment.registry.get('pbr_restore_fixture').lods) lod.traverse(mesh => {
      if (mesh.isMesh) result.push(mesh.material.userData.pbrReady && ['map', 'normalMap', 'roughnessMap'].every(key => !!mesh.material[key]?.image));
    });
    return result;
  });
  assert.ok(restored.length && restored.every(Boolean));
  checks.push({ customProjectTexturesRestored: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: checks.length }));
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
