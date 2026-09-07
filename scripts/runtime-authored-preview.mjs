import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url=process.env.EZ_TEST_URL||'http://127.0.0.1:5184';
const output=path.resolve('artifacts/authored-preview');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(120000);
const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const record=name=>{checks.push(name);console.log(`PASS ${name}`);};
try{
  await page.goto(url);
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready);
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.lastAuthoredMode),null);
  for(const kind of ['plant','rock','tree']){
    await page.locator(`[data-mode="${kind}"]`).click();
    await page.waitForFunction(kind=>{const s=window.__EZ_ENVIRONMENT__.studio;return s.mode===kind&&!s.pending&&(kind==='tree'||s.assetMode===kind);},kind);
    const author=await page.evaluate(()=>{const a=window.__EZ_ENVIRONMENT__,s=a.studio;return{visible:a.environment.visible,background:a.scene.background,exposure:a.renderer.toneMappingExposure,expectedExposure:a.environment.options.lighting.exposure,camera:s.cameraState(),hash:s.asset?.definitionHash};});
    assert.ok(author.visible);assert.equal(author.background,null);assert.equal(author.exposure,author.expectedExposure);
    await page.screenshot({path:path.join(output,`${kind}-editor.png`)});
    await page.locator('[data-mode="environment"]').click();
    await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__.studio.mode==='environment'&&!window.__EZ_ENVIRONMENT__.studio.pending);
    const env=await page.evaluate(()=>{const a=window.__EZ_ENVIRONMENT__,s=a.studio;return{latest:s.lastAuthoredMode,tree:a.tree.visible,asset:s.viewportGroup.visible,hash:s.asset?.definitionHash,camera:s.cameraState(),saved:s.project().lastAuthoredMode};});
    assert.equal(env.latest,kind);assert.equal(env.saved,kind);assert.equal(env.tree,kind==='tree');assert.equal(env.asset,kind!=='tree');
    if(kind!=='tree')assert.equal(env.hash,author.hash);
    for(const key of ['position','target'])env.camera[key].forEach((v,i)=>assert.ok(Math.abs(v-author.camera[key][i])<1e-6));
    await page.getByRole('button',{name:'Frame latest asset',exact:true}).click();
    await page.screenshot({path:path.join(output,`${kind}-environment.png`)});
    record(`${kind}: shared environment, latest item and close camera survive tab switch`);
  }
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.setMode('plant');s.change('height',2.75);await s.setMode('environment');});
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definition.height),2.75);
  record('Switching immediately after an edit previews the final definition');
  for(const biome of ['desert','forest','rocky','meadow']){
    const before=await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio;return s.controls.target.y-s.viewportGroup.position.y;});
    await page.evaluate(async biome=>{await window.__EZ_ENVIRONMENT__.studio.applyBiomePreset(biome);},biome);
    const result=await page.evaluate(async()=>{const a=window.__EZ_ENVIRONMENT__,s=a.studio,{terrainHeight}=await import('/environment/placement.js');return{visible:s.viewportGroup.visible,height:s.viewportGroup.position.y,expected:terrainHeight(0,0,a.environment.options),latest:s.lastAuthoredMode,relativeTarget:s.controls.target.y-s.viewportGroup.position.y,clearance:a.environment.lod.uniforms.ezPreviewRadius.value};});
    assert.ok(result.visible);assert.equal(result.latest,'plant');assert.equal(result.height,result.expected);
    assert.ok(Math.abs(result.relativeTarget-before)<1e-6);assert.ok(result.clearance>=3);
  }
  record('Latest item remains visible and follows terrain through all four biomes');
  for(const appearance of ['photorealistic','naturalistic']){
    await page.evaluate(async appearance=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.envChange({appearance},{modified:false});await s.setMode('rock');},appearance);
    assert.ok(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.environment.visible));
    const png=await page.evaluate(async()=>{const blob=await window.__EZ_ENVIRONMENT__.capturePNG('viewport',{download:false});return blob.size;});
    assert.ok(png>1000);
    await page.screenshot({path:path.join(output,`rock-${appearance}.png`)});
  }
  record('Plant/rock previews use environment lighting and PNG capture in both appearances');
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.setMode('plant');await s.setMode('environment');window.previewSaved=s.project();await s.setMode('rock');await s.loadProject(window.previewSaved);});
  assert.deepEqual(await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio;return[s.mode,s.lastAuthoredMode,s.assetMode,s.viewportGroup.visible,s.asset.definition.height];}),['environment','plant','plant',true,2.75]);
  record('Project restore regenerates the saved latest asset in Environment');
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await Promise.all([s.setMode('rock'),s.setMode('plant'),s.setMode('environment')]);});
  assert.deepEqual(await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio;return[s.mode,s.lastAuthoredMode,s.assetMode,s.viewportGroup.visible];}),['environment','plant','plant',true]);
  record('Rapid tab changes cannot replace the latest item with a stale generation');
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio,p=s.project();delete p.lastAuthoredMode;await s.loadProject(p);});
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.lastAuthoredMode),null);
  record('Older Environment projects without preview metadata still restore');
  assert.deepEqual(errors,[]);
}finally{
  await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2));
  await browser.close();
}
