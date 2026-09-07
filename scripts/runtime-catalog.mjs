import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('artifacts/catalog');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(120000);
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const record=(name,details={})=>{checks.push({name,...details});console.log(`PASS ${name}`);};
try{
  await page.goto(process.env.EZ_TEST_URL||'http://127.0.0.1:5184');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready);
  await page.evaluate(async()=>{
    const plants=await(await fetch('/generators/plants.js')).text(),assets=await(await fetch('/environment/assets.js')).text();
    window.catalogModuleUrls={three:plants.match(/import \* as THREE from "([^"]+)"/)[1],loader:assets.match(/import \{ GLTFLoader \} from "([^"]+)"/)[1]};
  });
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.envChange({radius:24,quality:'medium'});});
  const inventory=await page.evaluate(async()=>{const {ASSET_PRESETS}=await import('/generators/catalog.js');return ASSET_PRESETS.map(p=>({id:p.id,layer:p.layer,form:p.definition.archetype}));});
  for(const [mode,expected]of [['plant',27],['rock',22]]){
    await page.locator(`[data-mode="${mode}"]`).click();
    assert.equal(await page.locator('#studio-panel select[aria-label="Preset"] option').count(),expected+1);
    assert.ok(await page.locator('#studio-panel select[aria-label="Preset"] optgroup').count()>=4);
    const ids=inventory.filter(p=>mode==='plant'?['plants','grass','flowers'].includes(p.layer):['rocks','boulders','pebbles'].includes(p.layer));
    for(const {id}of ids){
      await page.getByLabel('Preset',{exact:true}).last().selectOption(id);
      await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending);
      assert.equal(await page.getByLabel('Preset',{exact:true}).last().inputValue(),id);
      const info=await page.evaluate(()=>{const a=window.__EZ_ENVIRONMENT__.studio.asset;return{hash:a.definitionHash,counts:a.lods.map(g=>{let n=0;g.traverse(o=>{if(o.geometry)n+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});return n;})};});
      assert.ok(info.counts[0]>info.counts[1]&&info.counts[1]>info.counts[2],id);
    }
    record(`${mode}: all ${expected} grouped presets generate and reduce LODs`);
  }
  for(const [mode,id,key,value]of [['plant','tall-seed-grass','height',1.8],['plant','saguaro-cactus','armCount',4],['rock','sandstone-outcrop','strata',.6]]){
    await page.locator(`[data-mode="${mode}"]`).click();await page.getByLabel('Preset',{exact:true}).last().selectOption(id);await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending);
    const result=await page.evaluate(async({key,value})=>{const s=window.__EZ_ENVIRONMENT__.studio;s.change(key,value);await s.ensureAsset();return{hash:s.asset.definitionHash,definition:s.asset.definition};},{key,value});
    await page.getByRole('button',{name:'Add to environment',exact:true}).click();
    await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__.studio.mode==='environment'&&!window.__EZ_ENVIRONMENT__.studio.pending);
    const restored=await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio,saved=s.project();await s.loadProject(saved);return{custom:s.environment.options.customSpecies.at(-1),hash:s.asset.definitionHash};});
    assert.equal(restored.hash,result.hash);assert.equal(restored.custom.definition[key],value);record(`${id}: authored edit, scatter and project restore preserve definition`);
  }
  // Direct export round trips run in the browser, where GLTFExporter has its real APIs.
  const exported=await page.evaluate(async()=>{
    const {ASSET_PRESETS}=await import('/generators/catalog.js'),{makeSpecies}=await import('/environment/species.js'),{exportGLB}=await import('/export/exporters.js');
    const {GLTFLoader}=await import(window.catalogModuleUrls.loader);
    const result=[];
    for(const id of ['tall-seed-grass','young-pine','saguaro-cactus','agave-rosette','moss-cushion','fallen-log','limestone-slab','mossy-forest-boulder','sandstone-outcrop','talus-scree']){
      const p=ASSET_PRESETS.find(p=>p.id===id),asset=makeSpecies(p.definition.archetype,p.definition);let bytes=0;
      for(const lod of asset.lods){const buffer=await exportGLB(lod);bytes+=buffer.byteLength;const gltf=await new GLTFLoader().parseAsync(buffer,'');if(!gltf.scene.children.length)throw new Error(`Empty export ${id}`);gltf.scene.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});}
      asset.dispose();result.push({id,bytes});
    }
    return result;
  });record('All new form families round-trip through real GLB at every LOD',{exported});
  // Isolated gallery for visual comparison under one camera and neutral lighting.
  await page.evaluate(async()=>{
    const THREE=await import(window.catalogModuleUrls.three),{ASSET_PRESETS}=await import('/generators/catalog.js'),{makeSpecies}=await import('/environment/species.js');
    const ids=['berry-thicket','wood-sorrel','moss-cushion','young-pine','fallen-log','short-meadow-grass','tall-seed-grass','clover-groundcover','sagebrush','dry-bunchgrass','saguaro-cactus','agave-rosette','alpine-grass-tuft','heather-cushion','wet-river-stone','desert-gravel','low-fieldstone','basalt-chunk','standing-stone','limestone-slab','red-sandstone-slab','glacial-erratic','volcanic-boulder','mossy-forest-boulder','talus-scree','river-stone-bed','granite-outcrop','sandstone-outcrop'];
    const overlay=document.createElement('div');overlay.id='catalog-gallery';Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:10000,background:'#253036',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gridAutoRows:'310px',alignContent:'start',overflow:'auto',padding:'12px',gap:'10px'});document.body.append(overlay);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(340,270);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
    const scenes=[];
    for(const id of ids){const p=ASSET_PRESETS.find(p=>p.id===id),a=makeSpecies(p.definition.archetype,p.definition),scene=new THREE.Scene();scene.background=new THREE.Color('#354047');scene.add(new THREE.HemisphereLight(0xe0edff,0x554936,2));const sun=new THREE.DirectionalLight(0xfff1d5,3);sun.position.set(3,5,4);scene.add(sun);
      const size=new THREE.Box3().setFromObject(a.object3D).getSize(new THREE.Vector3()),scale=2.1/Math.max(size.x,size.y,size.z);a.lods.forEach(l=>{l.scale.setScalar(scale);l.position.y=-size.y*scale/2;});scene.add(a.lods[0]);const camera=new THREE.PerspectiveCamera(38,340/270,.01,100);camera.position.set(2.6,1.8,3.3);camera.lookAt(0,0,0);
      const card=document.createElement('div');card.style.cssText='background:#354047;color:#f1ebdd;text-align:center;font:15px system-ui;border-radius:8px;overflow:hidden';const img=document.createElement('img');img.style.width='100%';const text=document.createElement('div');text.textContent=p.name;text.style.padding='8px';card.append(img,text);overlay.append(card);scenes.push({scene,camera,a,img});
    }
    window.catalogGallery={render(level){for(const e of scenes){e.a.lods.forEach(l=>e.scene.remove(l));e.scene.add(e.a.lods[level]);renderer.render(e.scene,e.camera);e.img.src=renderer.domElement.toDataURL();}},dispose(){for(const e of scenes)e.a.dispose();renderer.dispose();overlay.remove();}};
    window.catalogGallery.render(0);
  });
  await page.locator('#catalog-gallery').screenshot({path:path.join(output,'gallery-top.png')});
  for(const [name,scroll]of [['plants',0],['plants-lower',575],['rocks',1120],['formations',1600]]){await page.locator('#catalog-gallery').evaluate((el,scroll)=>el.scrollTop=scroll,scroll);await page.screenshot({path:path.join(output,`${name}.png`)});}
  for(const level of [1,2]){await page.evaluate(level=>window.catalogGallery.render(level),level);await page.locator('#catalog-gallery').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(output,`plants-lod${level}.png`)});}
  await page.evaluate(()=>window.catalogGallery.dispose());record('New preset visual galleries captured');
  for(const biome of ['forest','meadow','desert','rocky'])for(const appearance of ['naturalistic','photorealistic']){
    const metrics=await page.evaluate(async({biome,appearance})=>{const a=window.__EZ_ENVIRONMENT__,s=a.studio;s.lastAuthoredMode=null;await s.setMode('environment');await s.applyBiomePreset(biome);await s.envChange({radius:64,appearance});s.renderPanel();s.cameraPreset('overview');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));a.render();return{counts:s.environment.placement.count,calls:a.renderer.info.render.calls,triangles:a.renderer.info.render.triangles};},{biome,appearance});
    await page.screenshot({path:path.join(output,`${biome}-${appearance}-overview.png`)});
    await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.cameraPreset('ground'));await page.screenshot({path:path.join(output,`${biome}-${appearance}-ground.png`)});
    record(`${biome}/${appearance}: composition renders`,metrics);
  }
  assert.deepEqual(errors,[]);record('No browser or WebGL errors');
}finally{await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2));await browser.close();}
