import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('artifacts/surface-detail');await mkdir(output,{recursive:true});
const gltfLoaderUrl='/@fs/'+path.resolve('node_modules/three/examples/jsm/loaders/GLTFLoader.js').replaceAll('\\','/');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5194');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,{timeout:120000});
  const ids=await page.evaluate(async()=> (await import('/generators/catalog.js')).ASSET_PRESETS.map(p=>p.id));
  const extras=await page.evaluate(async()=>{const presets=new Set((await import('/generators/catalog.js')).ASSET_PRESETS.map(p=>p.id));return [...window.__EZ_ENVIRONMENT__.environment.registry.keys()].filter(id=>!presets.has(id)).map(id=>'legacy:'+id);});
  const results=process.env.EXTRAS_ONLY?JSON.parse(await readFile(path.join(output,'export-report.json'),'utf8')).results.filter(r=>!r.id.startsWith('legacy:')&&r.id!=='terrain'):[];
  for(const id of [...(process.env.EXTRAS_ONLY?[]:ids),...extras,'terrain']){
    const result=await page.evaluate(async ({id,gltfLoaderUrl})=>{
      const {ASSET_PRESETS}=await import('/generators/catalog.js');
      const plants=await import('/generators/plants.js'),rocks=await import('/generators/rocks.js');
      const {exportAssetPack,exportGLB}=await import('/export/exporters.js');
      const {readGLB,validateMaterialCatalog,appendMaterialCatalog}=await import('/export/material-catalog.js');
      const {GLTFLoader}=await import(gltfLoaderUrl);
      let asset;
      if(id.startsWith('legacy:')){asset={...window.__EZ_ENVIRONMENT__.environment.registry.get(id.split(':')[1]),dispose(){}};}
      else if(id==='terrain'){
        const env=window.__EZ_ENVIRONMENT__.environment;const candidates=[];env.traverse(m=>{if(m.isMesh&&m.geometry?.userData?.terrainTiles)candidates.push(m);});
        if(!candidates.length)throw new Error('No terrain mesh found');asset={object3D:candidates[0],lods:[candidates[0]],definition:{},dispose(){}};
      }else {const preset=ASSET_PRESETS.find(p=>p.id===id);asset=rocks.ROCK_ARCHETYPES.includes(preset.definition.archetype)?rocks.generateRock(preset.definition):plants.generatePlant(preset.definition);}
      let materials=0,images=0,roundTripMeshes=0,lods=0;const failures=[];
      try {
        let files;
        if(id==='terrain'){files={'terrain.glb':new Uint8Array(await exportGLB(asset.object3D,{maxTextureSize:128}))};await appendMaterialCatalog(files);}
        else ({files}=await exportAssetPack(asset,id.replace(':','-'),{download:false,maxTextureSize:128}));
        const catalog=JSON.parse(new TextDecoder().decode(files['materials.json']));validateMaterialCatalog(catalog,new Map(Object.entries(files)));
        for(const [file,bytes]of Object.entries(files)){
          if(!file.endsWith('.glb'))continue;lods++;
          const {json,binary}=readGLB(bytes);
          for(const m of json.materials??[]){materials++;if(!m.pbrMetallicRoughness?.baseColorTexture)failures.push(file+': '+m.name+' missing color');if(!m.normalTexture)failures.push(file+': '+m.name+' missing normal');if(!m.pbrMetallicRoughness?.metallicRoughnessTexture)failures.push(file+': '+m.name+' missing roughness');}
          for(const im of json.images??[]){images++;if(im.bufferView===undefined)throw new Error('External image');const view=json.bufferViews[im.bufferView],embedded=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
            const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',embedded))].map(n=>n.toString(16).padStart(2,'0')).join('');
            const companion=files['textures/'+hash+(im.mimeType==='image/jpeg'?'.jpg':'.png')];if(!companion||companion.length!==embedded.length||!companion.every((v,i)=>v===embedded[i]))throw new Error('Companion mismatch');
            const bitmap=await createImageBitmap(new Blob([embedded],{type:im.mimeType}));if(bitmap.width>128||bitmap.height>128)throw new Error('Texture cap exceeded');bitmap.close();
          }
          const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
          gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;roundTripMeshes++;if(!mesh.geometry.attributes.uv)failures.push(file+': missing UV on '+mesh.name);for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(!m.map||!m.normalMap||!m.roughnessMap)failures.push(file+': roundtrip missing maps on '+m.name);});
        }
        return {id,lods,materials,images,roundTripMeshes,companions:catalog.textures.length,failures};
      }finally {asset.dispose();}
    },{id,gltfLoaderUrl}).catch(e=>({id,failures:[e.message]}));
    results.push(result);console.log(JSON.stringify(result));
    await writeFile(path.join(output,'export-report.json'),JSON.stringify({passed:results.every(r=>!r.failures.length)&&!errors.length,results,errors},null,2));
  }
  if(results.some(r=>r.failures.length)||errors.length)process.exitCode=1;
}finally{await browser.close();}
