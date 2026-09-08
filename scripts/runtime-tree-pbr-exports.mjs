import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
const output=path.resolve('artifacts/tree-pbr-exports');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage();page.setDefaultTimeout(120000);const errors=[],exports=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(process.env.EZ_TEST_URL||'http://127.0.0.1:5194');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready);
  await page.evaluate(async()=>{const app=window.__EZ_ENVIRONMENT__;await app.studio.setMode('tree');app.tree.options.branch.levels=1;app.tree.options.branch.children[0]=3;app.tree.options.leaves.count=5;app.tree.generate();});
  // The legacy LOD switcher is hidden by the studio shell; exercise its handler.
  await page.locator('.lod-button').nth(1).evaluate(button => button.click());
  await page.locator('[data-tab="export"]').click();
  const before=await page.evaluate(()=>{const tree=window.__EZ_ENVIRONMENT__.tree;return{branch:tree.branchesMesh.geometry.uuid,leaf:tree.leavesMesh.geometry.uuid};});
  for(const [label,file]of [['Export GLB (Full Detail)','tree.glb'],['Export LODs (ZIP)','tree_lods.zip']]){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();await(await pending).saveAs(path.join(output,file));
    const bytes=new Uint8Array(await readFile(path.join(output,file))),files=file.endsWith('.zip')?unzipSync(bytes):{[file]:bytes};
    assert.equal(Object.keys(files).filter(name=>name.endsWith('.glb')).length,file.endsWith('.zip')?3:1);
    if(file.endsWith('.zip')) { assert.ok(files['materials.json']); assert.ok(Object.keys(files).some(name=>name.startsWith('textures/')&&name.endsWith('.png'))); }
    for(const[name,data]of Object.entries(files)){
      if(!name.endsWith('.glb'))continue;
      const view=new DataView(data.buffer,data.byteOffset,data.byteLength),gltf=JSON.parse(new TextDecoder().decode(data.subarray(20,20+view.getUint32(12,true))));
      assert.ok(gltf.materials.length>=2);
      for(const material of gltf.materials){assert.ok(material.pbrMetallicRoughness.baseColorTexture);assert.ok(material.normalTexture);assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);}
      assert.ok(gltf.images.every(image=>image.bufferView!==undefined));exports.push({file:name,materials:gltf.materials.length});
    }
  }
  const after=await page.evaluate(()=>{const tree=window.__EZ_ENVIRONMENT__.tree;return{branch:tree.branchesMesh.geometry.uuid,leaf:tree.leavesMesh.geometry.uuid};});
  assert.deepEqual(after,before);assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,exports,previewUnchanged:true,errors},null,2));console.log(JSON.stringify({passed:true,exports}));
}finally{await browser.close();}
