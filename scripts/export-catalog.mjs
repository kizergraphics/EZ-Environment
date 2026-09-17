import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ASSET_PRESETS } from '../src/app/generators/catalog.js';
import { makeSpecies } from '../src/app/environment/species.js';
import { validateOptions,LAYERS } from '../src/app/environment/options.js';
import { exportAssetPack,exportEnvironmentPack,validateManifest } from '../src/app/export/exporters.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.FileReader??=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();},e=>this.onerror?.(e));}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.();},e=>this.onerror?.(e));}
};
const selected=ASSET_PRESETS.filter(p=>p.definition.seed>=7101&&p.definition.seed<=7114||p.definition.seed>=7201&&p.definition.seed<=7203||p.definition.seed>=8101&&p.definition.seed<=8114);
const output=path.resolve('artifacts/catalog/export');await mkdir(output,{recursive:true});
const registry=new Map(),layers=Object.fromEntries(LAYERS.map(l=>[l,{records:[]}]));
const ground=new THREE.Mesh(new THREE.PlaneGeometry(64,64).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#786b53'}));
try{
  for(const [i,p]of selected.entries()){
    const asset=makeSpecies(p.definition.archetype,p.definition);registry.set(p.id,asset);
    const pack=await exportAssetPack(asset,p.id,{download:false});assert.equal(validateManifest(pack.manifest,pack.files).valid,true);
    const descriptor=pack.manifest.assets[0];assert.deepEqual(JSON.parse(new TextDecoder().decode(pack.files[descriptor.preset])),p.definition);
    if(['cactus','deadwood','succulent'].includes(p.definition.archetype))assert.equal(descriptor.wind.enabled,false);
    for(const lod of descriptor.lods){const bytes=pack.files[lod.file];const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
      let triangles=0;gltf.scene.traverse(o=>{if(o.geometry){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;o.geometry.dispose();}o.material?.dispose();});assert.equal(triangles,lod.triangles);
    }
    await writeFile(path.join(output,`${p.id}.zip`),new Uint8Array(await pack.blob.arrayBuffer()));
    for(let copy=0;copy<2;copy++)layers[p.layer].records.push({species:p.id,position:[(i%7)*7-22+copy*2.7,0,Math.floor(i/7)*8-13],normal:[0,1,0],yaw:copy*.6,scale:[1,1,1],tint:copy?.93:1,variationSeed:i*2+copy});
  }
  const fixture={registry,ground,options:validateOptions({radius:32}),placement:{hash:'catalog-expansion-v1',chunks:new Map([['0:0',{x:0,z:0,layers}]])}};
  const pack=await exportEnvironmentPack(fixture,{download:false,name:'catalog-environment'});assert.equal(validateManifest(pack.manifest,pack.files).valid,true);
  const root=path.join(output,'pack');await mkdir(root,{recursive:true});
  for(const [relative,bytes]of Object.entries(pack.files)){const target=path.resolve(root,relative);assert.ok(target.startsWith(root+path.sep));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  await writeFile(path.join(output,'catalog-environment.zip'),new Uint8Array(await pack.blob.arrayBuffer()));
  const report={assets:pack.manifest.assets.length,instances:pack.manifest.chunks.reduce((s,c)=>s+c.count,0),allAssetLODAndPresetRoundTrips:true,windMetadataVerified:true,fixture:root};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{registry.forEach(a=>a.dispose());ground.geometry.dispose();ground.material.dispose();}
