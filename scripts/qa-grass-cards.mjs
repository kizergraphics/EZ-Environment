// Browser verification of actual grass cutouts, PBR rendering and GLB round trips.
// Run with the dev server on 5197: node scripts/qa-grass-cards.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts/grass-cards-v2');
await mkdir(output, { recursive:true });
const browser = await chromium.launch({ channel:'msedge', headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1500,height:840}, deviceScaleFactor:1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if(message.type()==='error') errors.push(message.text()); });
  await page.route('**/grass-qa', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html><head><style>body{margin:0;background:#ced3d5;font:16px Arial;color:#263332}canvas{display:block}#labels{display:flex;justify-content:space-around;position:absolute;bottom:24px;left:0;right:0;font-weight:600}</style></head><body><div id="labels"></div></body></html>' }));
  await page.goto('http://127.0.0.1:5197/grass-qa');
  const result = await page.evaluate(async ({ threePath }) => {
    const THREE = await import(threePath);
    const {createPlantDefinition,generatePlant,GRASS_CARD_LAYOUTS}=await import('/generators/plants.js');
    const {prepareAssetMaterials}=await import('/materials/pbr.js');
    const {exportGLB}=await import('/export/exporters.js');
    const {GLTFLoader}=await import(threePath.replace('/build/three.module.js','/examples/jsm/loaders/GLTFLoader.js'));
    const atlas=await (await fetch('/generators/grass-atlas-v2.json')).json();
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1500,840); renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
    document.body.prepend(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#ced3d5');
    scene.add(new THREE.HemisphereLight('#ffffff','#7c8367',2));
    const key=new THREE.DirectionalLight('#fff9e5',2.6);key.position.set(-3,6,5);scene.add(key);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#a5aba1',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;scene.add(floor);
    const camera=new THREE.PerspectiveCamera(34,1500/840,.01,100);
    const assets=[];
    for(const [index,cardLayout] of GRASS_CARD_LAYOUTS.entries()){
      const asset=generatePlant(createPlantDefinition('grass',{cardLayout,height:1,width:1,seed:7106}));
      await prepareAssetMaterials(asset);asset.object3D.position.x=(index-1.5)*1.65;scene.add(asset.object3D);assets.push(asset);
    }
    document.querySelector('#labels').innerHTML=['3 cards · 6 triangles','4 cards · 8 triangles','5 cards · 10 triangles','6 cards · 12 triangles'].map(s=>`<span>${s}</span>`).join('');
    const draw=(angle='oblique')=>{camera.up.set(0,1,0);if(angle==='top'){camera.position.set(0,8,.001);camera.up.set(0,0,-1);}else if(angle==='side')camera.position.set(0,.65,8.5);else camera.position.set(0,3.6,8);camera.lookAt(0,.45,0);renderer.render(scene,camera);};
    const comparison=async()=>{
      for(const asset of assets)asset.object3D.visible=false;
      const current=assets[2].object3D;current.visible=true;current.position.x=1.05;
      const old=generatePlant(createPlantDefinition('grass',{cardLayout:'naturalOffset',height:1,width:1,seed:7106}));
      const mesh=old.object3D.children[0],uv=mesh.geometry.attributes.uv;
      for(const [i,cell]of [0,1,4,6,8].entries()){
        const col=cell%4,row=Math.floor(cell/4),pad=.012;
        const u0=col/4+pad,u1=(col+1)/4-pad,v0=1-(row+1)/4+pad,v1=1-row/4-pad;
        [[u0,v0],[u1,v0],[u1,v1],[u0,v1]].forEach(([u,v],corner)=>uv.setXY(i*4+corner,u,v));
      }uv.needsUpdate=true;
      const oldMap=await new THREE.TextureLoader().loadAsync('/textures/grass/grass-clumps-v1.png');oldMap.colorSpace=THREE.SRGBColorSpace;
      mesh.material.map=oldMap;mesh.material.color.set('#ffffff');mesh.material.needsUpdate=true;
      old.object3D.position.x=-1.05;scene.add(old.object3D);
      camera.position.set(0,1.8,4.5);camera.up.set(0,1,0);camera.lookAt(0,.5,0);
      document.querySelector('#labels').innerHTML='<span>Before · opaque clusters</span><span>After · separate blades and open gaps</span>';
      renderer.render(scene,camera);
    };
    window.grassQA={assets,scene,renderer,camera,draw,comparison};draw();
    const image=assets[0].object3D.children[0].material.map.image;
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;
    const masks={};
    for(const [name,region]of Object.entries(atlas.regions)){
      const [left,top,width,height]=region.pixels;let opaque=0,midOpaque=0,midTotal=0;
      for(let y=top;y<top+height;y++)for(let x=left;x<left+width;x++){const solid=pixels[(y*image.width+x)*4+3]>=115;if(solid)opaque++;if(y>top+height*.25&&y<top+height*.75){midTotal++;if(solid)midOpaque++;}}
      masks[name]={coverage:opaque/(width*height),middleCoverage:midOpaque/midTotal};
    }
    const roundTrips=[];
    for(const asset of assets)for(const [level,lod]of asset.lods.entries()){
      const bytes=await exportGLB(lod,{maxTextureSize:2048});
      const loaded=await new GLTFLoader().parseAsync(bytes,'');
      let triangles=0,material;
      loaded.scene.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;material=o.material;}});
      const probe=document.createElement('canvas');probe.width=material.map.image.width;probe.height=material.map.image.height;const probeCtx=probe.getContext('2d');probeCtx.drawImage(material.map.image,0,0);const alpha=probeCtx.getImageData(0,0,probe.width,probe.height).data;let solid=0;for(let i=3;i<alpha.length;i+=4)if(alpha[i]>=115)solid++;
      roundTrips.push({layout:asset.definition.cardLayout,level,triangles,expected:lod.userData.triangles,alphaTest:material.alphaTest,doubleSide:material.side===THREE.DoubleSide,mapSize:[material.map.image.width,material.map.image.height],alphaCoverage:solid/(probe.width*probe.height),normal:!!material.normalMap,roughness:!!material.roughnessMap,revision:material.userData.grassAtlasRevision});
      loaded.scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const slot of ['map','normalMap','roughnessMap','metalnessMap'])o.material[slot]?.dispose();o.material.dispose();}});
    }
    return {masks,roundTrips};
  }, {threePath:'/@fs/'+path.join(root,'node_modules/three/build/three.module.js').replaceAll('\\','/')});
  for(const angle of ['oblique','side','top']){
    await page.evaluate(angle=>window.grassQA.draw(angle),angle);
    await page.screenshot({path:path.join(output,`grass-${angle}.png`)});
  }
  await page.evaluate(()=>window.grassQA.comparison());
  await page.screenshot({path:path.join(output,'grass-before-after.png')});
  for(const [name,mask]of Object.entries(result.masks)){
    assert.ok(mask.coverage>.03&&mask.coverage<.4,`${name} opaque fill ${mask.coverage}`);
    assert.ok(mask.middleCoverage<.4,`${name} lacks open gaps through its center`);
  }
  for(const lod of result.roundTrips){assert.equal(lod.triangles,lod.expected);assert.equal(lod.alphaTest,.45);assert.equal(lod.doubleSide,true);assert.equal(lod.normal,true);assert.equal(lod.roughness,true);assert.equal(lod.revision,2);assert.ok(lod.alphaCoverage>.03&&lod.alphaCoverage<.2,'Export must retain transparent gaps');}
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({...result,errors},null,2)+'\n');
  console.log(JSON.stringify({output,masks:result.masks,roundTrips:result.roundTrips.length,errors},null,2));
}finally{await browser.close();}
