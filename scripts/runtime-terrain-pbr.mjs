import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.EZ_TEST_URL||'http://127.0.0.1:5192');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready&&!window.__EZ_ENVIRONMENT__.environment.loading,null,{timeout:120000});
const result=await page.evaluate(async()=>{
const app=window.__EZ_ENVIRONMENT__;await app.studio.setMode('environment');
const ground=app.environment.ground;
app.camera.position.set(8,7,12);app.controls.target.set(0,1,0);app.controls.update();
const {exportGLB}=await import('/export/exporters.js');
const binary=await exportGLB(ground,{maxTextureSize:1024}),view=new DataView(binary);
const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(binary,20,view.getUint32(12,true))));
return {materials:ground.material.map(m=>({map:[m.map?.image.width,m.map?.image.height],normal:m.normalMap?.channel,roughness:m.roughnessMap?.channel})),groups:ground.geometry.groups,errors:app.environment.error,export:{materials:gltf.materials,uv1:gltf.meshes.every(mesh=>mesh.primitives.every(p=>p.attributes.TEXCOORD_1!==undefined))}};
});
assert.equal(result.errors,null);assert.equal(result.export.uv1,true);
assert.ok(result.export.materials.every(m=>m.normalTexture&&m.pbrMetallicRoughness.baseColorTexture&&m.pbrMetallicRoughness.metallicRoughnessTexture));
assert.ok(result.export.materials.slice(0,4).every(m=>m.normalTexture.texCoord===1));
assert.deepEqual(errors,[]);
console.log(JSON.stringify(result,null,2));
await mkdir('artifacts/pbr',{recursive:true});await page.screenshot({path:'artifacts/pbr/terrain.png'});console.log({errors});
}finally{await browser.close();}
