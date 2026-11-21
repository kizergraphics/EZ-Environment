import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console', message => {
  if (['warning', 'error'].includes(message.type())) errors.push(message.text());
});
await page.goto(process.env.EZ_TEST_URL||'http://127.0.0.1:5192');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready&&!window.__EZ_ENVIRONMENT__.environment.loading,null,{timeout:120000});
const result = await page.evaluate(async () => {
  const app = window.__EZ_ENVIRONMENT__;
  await app.studio.setMode('environment');
  const { applyMeadowPreset } = await import('/environment/biomes.js');
  const { exportGLB } = await import('/export/exporters.js');
  const { readGLB } = await import('/export/material-catalog.js');
  const checks = [];
  for (const biome of ['meadow']) {
    const options = applyMeadowPreset({ ...app.environment.options, radius: 16 });
    await app.environment.setOptions(options);
    const ground = app.environment.ground, material = ground.material;
    const maps = [material.map, material.normalMap, material.roughnessMap].map(texture => new URL(texture.image.src).pathname);
    const bytes = new Uint8Array(await exportGLB(ground, { maxTextureSize: 1024 }));
    const { json } = readGLB(bytes);
    checks.push({ biome, maps, material: json.materials[0], primitives: json.meshes[0].primitives });
  }
  return { checks, error: app.environment.error };
});
const sources = { meadow: 'meadow-soil' };
assert.equal(result.error, null);
for (const { biome, maps, material, primitives } of result.checks) {
  const path = `/textures/biomes/${sources[biome]}/`;
  assert.ok(maps.every(url => url.startsWith(path)));
  assert.ok(material.normalTexture);
  assert.equal(material.normalTexture.texCoord ?? 0, 0);
  assert.ok(material.pbrMetallicRoughness.baseColorTexture);
  assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);
  assert.ok(primitives.every(p => p.attributes.TEXCOORD_0 !== undefined && p.attributes.COLOR_0 !== undefined));
}
assert.deepEqual(errors, []);
console.log(JSON.stringify(result, null, 2));
await mkdir('artifacts/pbr', { recursive: true });
await page.screenshot({ path: 'artifacts/pbr/terrain.png' });
} finally { await browser.close(); }
