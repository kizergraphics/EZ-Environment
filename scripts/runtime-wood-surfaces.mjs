import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('artifacts/wood-surfaces');await mkdir(output,{recursive:true});
const threeModuleUrl='/@fs/'+path.resolve('node_modules/three/build/three.module.js').replaceAll('\\','/');
const gltfLoaderUrl='/@fs/'+path.resolve('node_modules/three/examples/jsm/loaders/GLTFLoader.js').replaceAll('\\','/');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(process.env.EZ_TEST_URL||'http://127.0.0.1:5194');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready);
  const results=[];
  for(const kind of ['deadwood','fallen_log','trellis']) {
    const result=await page.evaluate(async ({kind,threeModuleUrl,gltfLoaderUrl})=>{
      const THREE=await import(threeModuleUrl);
      const {generatePlant,createPlantDefinition}=await import('/generators/plants.js');
      const {extraSpecies}=await import('/environment/biome-species.js');
      const {prepareAssetMaterials,assertPbrReady}=await import('/materials/pbr.js');
      const {loadWoodMaps}=await import('/materials/wood-surface.js');
      const {exportGLB}=await import('/export/exporters.js');
      const {readGLB}=await import('/export/material-catalog.js');
      const {GLTFLoader}=await import(gltfLoaderUrl);
      let asset;
      if(kind==='trellis') {
        const tree=window.__EZ_ENVIRONMENT__.tree;
        tree.options.trellis.enabled=true;tree.options.trellis.visible=true;
        Object.assign(tree.options.trellis,{width:3,height:2,spacing:.5,cylinderRadius:.075,position:{x:0,y:0,z:0}});
        tree.generate();await Promise.all([loadWoodMaps('wood'),loadWoodMaps('endgrain')]);
        if(!tree.options.trellis.maps?.map?.image||!tree.options.trellis.endMaps?.map?.image)throw Error('Tree did not receive wood maps');
        const {cleanTreeDefinition}=await import('/studio/tree-project.js');
        const clean=cleanTreeDefinition(tree);
        if('maps' in clean.trellis||'endMaps' in clean.trellis)throw Error('Project retained runtime textures');
        asset={lods:[tree.trellisMesh.clone()]};
      }else asset=kind==='deadwood'?generatePlant(createPlantDefinition('deadwood',{stemMaterial:'bark'})):extraSpecies(kind);
      await prepareAssetMaterials(asset);
      let capTriangles=0,roundTripMeshes=0;const families=new Set();
      for(const lod of asset.lods) {
        assertPbrReady(lod,{requireAll:true});
        lod.traverse(mesh=>{
          if(!mesh.isMesh)return;families.add(mesh.material.userData.pbrFamily);
          if(mesh.material.userData.pbrFamily!=='endgrain')return;
          const uv=mesh.geometry.attributes.uv,idx=mesh.geometry.index;
          for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);
            const area=(uv.getX(b)-uv.getX(a))*(uv.getY(c)-uv.getY(a))-(uv.getY(b)-uv.getY(a))*(uv.getX(c)-uv.getX(a));
            if(Math.abs(area)<1e-6)throw Error('Degenerate cut-end UV');capTriangles++;
          }
        });
        const bytes=new Uint8Array(await exportGLB(lod,{maxTextureSize:512}));
        const {json}=readGLB(bytes);
        if(!json.images.every(image=>image.bufferView!==undefined))throw Error('External texture');
        const gltf=await new GLTFLoader().parseAsync(bytes.buffer,'');
        gltf.scene.traverse(mesh=>{if(mesh.isMesh){roundTripMeshes++;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(!m.map||!m.normalMap||!m.roughnessMap)throw Error('Missing roundtrip map '+m.name);}});
      }
      if(!families.has('wood')||!families.has('endgrain'))throw Error('Missing wood family');
      document.querySelector('#wood-qa')?.remove();
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.domElement.id='wood-qa';renderer.setSize(1200,900);renderer.setPixelRatio(1);renderer.setClearColor('#858b8b');renderer.domElement.style.cssText='position:fixed;inset:0;z-index:999999';document.body.append(renderer.domElement);
      const scene=new THREE.Scene();scene.add(asset.lods[0].clone());scene.add(new THREE.HemisphereLight(0xffffff,0x555344,2));
      const sun=new THREE.DirectionalLight(0xfff2df,3);sun.position.set(3,5,4);scene.add(sun);
      const bounds=new THREE.Box3().setFromObject(scene),center=bounds.getCenter(new THREE.Vector3());
      const camera=new THREE.PerspectiveCamera(38,4/3,.01,100);camera.position.copy(center).add(new THREE.Vector3(kind==='trellis'?3.3:3.2,kind==='trellis'?1.8:1.35,kind==='trellis'?4.5:2.5));camera.lookAt(center);renderer.render(scene,camera);
      return {kind,lods:asset.lods.length,families:[...families],capTriangles,roundTripMeshes};
    },{kind,threeModuleUrl,gltfLoaderUrl});
    await page.screenshot({path:path.join(output,`${kind}-close.png`)});results.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,results,errors},null,2));
}finally{await browser.close();}
