import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'artifacts','runtime');
await mkdir(output,{recursive:true});
const url=process.env.EZ_TEST_URL||'http://127.0.0.1:5173';
let server=null,serverOutput='';
if(!process.env.EZ_TEST_URL){
  server=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--config','vite.app.config.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data=>{serverOutput+=data;});server.stderr.on('data',data=>{serverOutput+=data;});
}
const report={startedAt:new Date().toISOString(),url,viewport:{width:1920,height:1080},checks:[],assets:[],errors:[],consoleErrors:[],externalRequests:[],screenshots:[]};
let browser,page;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record=(name,data={})=>{report.checks.push({name,passed:true,...data});console.log(`PASS ${name}`);};
try{
  for(let tries=0;tries<80;tries++){
    try{if((await fetch(url)).ok)break;}catch{}
    if(server?.exitCode!==null&&server?.exitCode!==undefined)throw new Error(`Vite exited before startup: ${serverOutput}`);
    if(tries===79)throw new Error(`Vite did not start: ${serverOutput}`);
    await delay(250);
  }
  browser=await chromium.launch({channel:process.env.EZ_TEST_BROWSER||'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling']});
  const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1,acceptDownloads:true});
  page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>{report.errors.push(error.message);console.error('PAGE ERROR',error.message);});
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('request',request=>{const target=request.url();if(/^https?:/.test(target)&&!target.startsWith(url))report.externalRequests.push(target);});
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,{timeout:60000});
  await page.waitForFunction(()=>document.getElementById('loading-screen')?.hidden||document.getElementById('loading-screen')?.style.display==='none'||!document.getElementById('loading-screen'));
  record('App startup and environment initialization',await page.evaluate(()=>({mode:window.__EZ_ENVIRONMENT__.mode,count:window.__EZ_ENVIRONMENT__.environment.placement.count})));
  const screenshot=async name=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const target=path.join(output,`${name}.png`);await page.screenshot({path:target});report.screenshots.push(target);
  };
  const mode=async value=>{
    await page.locator(`[data-mode="${value}"]`).click();
    await page.waitForFunction(expected=>{const s=window.__EZ_ENVIRONMENT__?.studio;return s?.mode===expected&&(!['plant','rock'].includes(expected)||s.asset&&!s.pending&&s.asset.definition.archetype===s.definitions[expected].archetype);},value);
    record(`${value} mode`);
  };
  await screenshot('tree');
  for(const [kind,forms]of [['plant',['shrub','bush','sapling','fern','weed','groundCover','flower']],['rock',['pebble','rock','boulder','cluster']]]){
    await mode(kind);
    for(const form of forms){
      await page.locator('#studio-panel').getByLabel('Form',{exact:true}).selectOption(form);
      await page.waitForFunction(archetype=>{const s=window.__EZ_ENVIRONMENT__.studio;return !s.pending&&s.asset?.definition.archetype===archetype;},form);
      const stats=await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio,a=s.asset;return{archetype:a.definition.archetype,hash:a.definitionHash,ms:a.ms,distinctCenters:a.lods.map(lod=>new Set(lod.children.filter(o=>o.isMesh).map(o=>o.position.toArray().join(','))).size),lods:a.lods.map(lod=>{let triangles=0;lod.traverse(o=>{if(o.geometry)triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});return triangles;})};});
      assert.ok(stats.lods[0]>stats.lods[1]&&stats.lods[1]>stats.lods[2],`${form} must have decreasing LOD counts.`);
      if(form==='cluster')assert.ok(stats.distinctCenters.every(count=>count>1),'Cluster transforms must survive worker serialization in every LOD.');
      report.assets.push(stats);record(`${form} generation and LODs`,stats);
      await screenshot(`${kind}-${form}`);
      for(const lod of [1,2]){
        await page.locator('#studio-panel').getByRole('button',{name:`LOD ${lod}`,exact:true}).click();
        assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.lod),lod);
      }
      await page.locator('#studio-panel').getByRole('button',{name:'Full',exact:true}).click();
    }
  }
  await mode('plant');
  await page.locator('#studio-panel').getByLabel('Form',{exact:true}).selectOption('shrub');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definition.archetype==='shrub');
  const oldHash=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definitionHash);
  const seed=page.locator('#studio-panel').getByLabel('Seed',{exact:true});await seed.fill('123456');await seed.press('Tab');
  await page.waitForFunction(hash=>{const s=window.__EZ_ENVIRONMENT__.studio;return !s.pending&&s.asset.definition.seed===123456&&s.asset.definitionHash!==hash;},oldHash);
  const editedHash=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definitionHash);assert.notEqual(editedHash,oldHash);record('Seed edit generates a new form');
  const download=async(label,name,container=page)=>{
    const waiting=page.waitForEvent('download');await container.getByRole('button',{name:label,exact:true}).click();const item=await waiting;
    const target=path.join(output,name);await item.saveAs(target);const bytes=await readFile(target);assert.ok(bytes.length>20,`${label} must produce content.`);return{target,bytes};
  };
  const saved=await download('Save project','project.json');const project=JSON.parse(saved.bytes.toString());assert.equal(project.format,'ez-environment-project');assert.equal(project.plant.seed,123456);record('Save project JSON',{bytes:saved.bytes.length});
  const preset=await download('Save preset JSON','plant-preset.json',page.locator('#studio-panel'));assert.equal(JSON.parse(preset.bytes.toString()).definition.seed,123456);record('Save plant preset JSON');
  const glb=await download('Export GLB','shrub-lod0.glb',page.locator('#studio-panel'));assert.equal(glb.bytes.toString('ascii',0,4),'glTF');assert.equal(glb.bytes.readUInt32LE(8),glb.bytes.length);record('Export valid plant GLB',{bytes:glb.bytes.length});
  await seed.fill('654321');await seed.press('Tab');await page.waitForFunction(hash=>{const s=window.__EZ_ENVIRONMENT__.studio;return !s.pending&&s.asset.definition.seed===654321&&s.asset.definitionHash!==hash;},editedHash);
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open project',exact:true}).click();await (await chooser).setFiles(saved.target);
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__.studio.asset?.definition.seed===123456&&!window.__EZ_ENVIRONMENT__.studio.pending&&document.getElementById('studio-status').textContent==='Workspace restored.');
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definitionHash),editedHash);record('Open project reproduces the authored plant');
  const worker=await page.evaluate(async()=>{
    const {GenerationClient}=await import('/studio/generation.js');const client=new GenerationClient();
    const definition=window.__EZ_ENVIRONMENT__.studio.definitions.plant;
    const older=client.generate('plant',{...definition,seed:9001,stemCount:16,branches:20,density:2.5});
    const newer=client.generate('plant',{...definition,seed:9002});
    const [first,last]=await Promise.all([older,newer]);const result={canceled:first===null,seed:last?.definition.seed};last?.dispose();client.dispose();return result;
  });
  assert.equal(worker.canceled,true);assert.equal(worker.seed,9002);record('Worker cancellation keeps only the latest request');
  const openFile=async(label,file,container=page)=>{const waiting=page.waitForEvent('filechooser');await container.getByRole('button',{name:label,exact:true}).click();await(await waiting).setFiles(file);};
  const assertGLB=bytes=>{
    assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(8),bytes.length);
    const length=bytes.readUInt32LE(12);return JSON.parse(bytes.toString('utf8',20,20+length).trim());
  };
  const assertPack=(bytes,kind)=>{
    const files=unzipSync(new Uint8Array(bytes)),manifest=JSON.parse(Buffer.from(files['manifest.json']).toString());
    assert.equal(manifest.kind,'asset');assert.equal(manifest.assets[0].lods.length,3);
    for(const lod of manifest.assets[0].lods)assertGLB(Buffer.from(files[lod.file]));
    const definition=JSON.parse(Buffer.from(files[manifest.assets[0].preset]).toString());assert.equal(definition.archetype,kind);
    return{files:Object.keys(files).length,bytes:bytes.length,lods:manifest.assets[0].lods.map(lod=>lod.triangles)};
  };
  await page.locator('#studio-panel').getByRole('button',{name:'New variation',exact:true}).click();
  await page.waitForFunction(hash=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definitionHash!==hash,editedHash);
  await openFile('Load preset JSON',preset.target,page.locator('#studio-panel'));
  await page.waitForFunction(hash=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definitionHash===hash,editedHash);
  record('Load plant preset restores definition and geometry');
  const plantPack=await download('Export asset + LOD pack','plant-asset.zip',page.locator('#studio-panel'));record('Plant asset ZIP contains three valid LOD GLBs',assertPack(plantPack.bytes,'shrub'));
  await mode('rock');await page.locator('#studio-panel').getByLabel('Form',{exact:true}).selectOption('rock');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definition.archetype==='rock');
  const rockHash=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definitionHash);
  const rockPreset=await download('Save preset JSON','rock-preset.json',page.locator('#studio-panel'));
  await page.locator('#studio-panel').getByRole('button',{name:'New variation',exact:true}).click();
  await page.waitForFunction(hash=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definitionHash!==hash,rockHash);
  await openFile('Load preset JSON',rockPreset.target,page.locator('#studio-panel'));
  await page.waitForFunction(hash=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definitionHash===hash,rockHash);record('Rock preset save/load restores geometry');
  const rockPack=await download('Export asset + LOD pack','rock-asset.zip',page.locator('#studio-panel'));record('Rock asset ZIP contains three valid LOD GLBs',assertPack(rockPack.bytes,'rock'));
  const beforeInvalid=await page.evaluate(()=>({mode:window.__EZ_ENVIRONMENT__.mode,asset:window.__EZ_ENVIRONMENT__.studio.asset.definitionHash,placement:window.__EZ_ENVIRONMENT__.environment.placement.hash}));
  await openFile('Open project',{name:'invalid-project.json',mimeType:'application/json',buffer:Buffer.from('{"format":"unsupported","version":9}')});
  await page.waitForFunction(()=>document.getElementById('studio-status').textContent.startsWith('Could not open file:'));
  const afterInvalid=await page.evaluate(()=>({mode:window.__EZ_ENVIRONMENT__.mode,asset:window.__EZ_ENVIRONMENT__.studio.asset.definitionHash,placement:window.__EZ_ENVIRONMENT__.environment.placement.hash}));
  assert.deepEqual(afterInvalid,beforeInvalid);record('Invalid project leaves the current scene and asset intact');
  const malformedTree=await page.evaluate(()=>{const project=structuredClone(window.__EZ_ENVIRONMENT__.studio.project());project.tree.seed='not-a-seed';return project;});
  await openFile('Open project',{name:'invalid-tree-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(malformedTree))});
  await page.waitForFunction(()=>document.getElementById('studio-status').textContent.startsWith('Could not open file:'));
  const afterBadTree=await page.evaluate(()=>({mode:window.__EZ_ENVIRONMENT__.mode,asset:window.__EZ_ENVIRONMENT__.studio.asset.definitionHash,placement:window.__EZ_ENVIRONMENT__.environment.placement.hash}));
  assert.deepEqual(afterBadTree,beforeInvalid);record('Malformed project tree leaves the live scene unchanged');
  await mode('environment');await screenshot('environment');
  const originalGrass=await page.evaluate(()=>structuredClone(window.__EZ_ENVIRONMENT__.environment.options.layers.grass));
  const grassSection=()=>page.locator('#studio-panel .studio-scroll > details').filter({has:page.locator('summary').filter({hasText:/^Grass$/})});
  const openDetails=async locator=>{if(!await locator.evaluate(node=>node.open))await locator.locator(':scope > summary').click();};
  const grassAdvanced=()=>grassSection().locator('details');
  const grassForms=[];
  for(const id of ['grass','grass_short','grass_tall','grass_clump']){
    await openDetails(grassSection());await grassSection().getByLabel('Species',{exact:true}).selectOption(id);
    await page.waitForFunction(id=>{const e=window.__EZ_ENVIRONMENT__.environment;return!e.loading&&e.options.layers.grass.species===id;},id);
    grassForms.push(await page.evaluate(id=>{const e=window.__EZ_ENVIRONMENT__.environment;let count=0;e.traverse(o=>{if(o.isInstancedMesh&&o.name===`grass_${id}`)count+=o.count;});return{id,count,variant:e.registry.get(id).definition.variant};},id));
  }
  assert.ok(grassForms.every(form=>form.count>0));assert.equal(new Set(grassForms.map(form=>form.variant)).size,4);record('All four grass variants render through the Species control',{grassForms});
  await openDetails(grassSection());
  const originalColor=await page.evaluate(()=>{let color;window.__EZ_ENVIRONMENT__.environment.traverse(o=>{if(!color&&o.isInstancedMesh&&o.name.startsWith('grass_'))color=o.material.color.toArray();});return color;});
  await grassSection().getByLabel('Dryness',{exact:true}).fill('.8');await grassSection().getByLabel('Dryness',{exact:true}).press('Tab');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.layers.grass.dryness===.8);
  const dryColor=await page.evaluate(()=>{let color;window.__EZ_ENVIRONMENT__.environment.traverse(o=>{if(!color&&o.isInstancedMesh&&o.name.startsWith('grass_'))color=o.material.color.toArray();});return color;});assert.notDeepEqual(dryColor,originalColor);record('Grass dryness updates rendered material colors');
  await grassSection().getByLabel('Blade height',{exact:true}).fill('1.6');await grassSection().getByLabel('Blade height',{exact:true}).press('Tab');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.layers.grass.height===1.6);
  const bladeScales=await page.evaluate(()=>[...window.__EZ_ENVIRONMENT__.environment.placement.chunks.values()].flatMap(c=>c.layers.grass.records.slice(0,1).map(r=>r.scale)));
  assert.ok(bladeScales.every(s=>Math.abs(s[1]/s[0]-1.6)<1e-8));record('Grass blade height applies to placement scales');
  await openDetails(grassAdvanced());await grassAdvanced().getByLabel('Mix species',{exact:true}).check();
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.layers.grass.speciesChoices.length===4);
  const mixedGrass=await page.evaluate(()=>{const e=window.__EZ_ENVIRONMENT__.environment,ids=new Set(),draws=new Set();for(const c of e.placement.chunks.values())for(const r of c.layers.grass.records)ids.add(r.species);e.traverse(o=>{if(o.isInstancedMesh&&o.name.startsWith('grass_'))draws.add(o.name);});return{ids:[...ids],draws:[...draws]};});
  assert.equal(mixedGrass.ids.length,4);assert.ok(mixedGrass.ids.every(id=>mixedGrass.draws.includes(`grass_${id}`)));record('Weighted species mix produces corresponding instance batches',mixedGrass);
  const maskPNG=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;const context=c.getContext('2d');context.fillStyle='black';context.fillRect(0,0,2,2);context.fillStyle='white';context.fillRect(1,0,1,2);return c.toDataURL('image/png').split(',')[1];});
  await openDetails(grassSection());await openDetails(grassAdvanced());
  await openFile('Load grayscale density map',{name:'half-density.png',mimeType:'image/png',buffer:Buffer.from(maskPNG,'base64')},grassAdvanced());
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&!!window.__EZ_ENVIRONMENT__.environment.options.layers.grass.densityMap);
  const mapState=await page.evaluate(()=>{const e=window.__EZ_ENVIRONMENT__.environment;return{map:e.options.layers.grass.densityMap,count:e.placement.count.grass};});assert.deepEqual(mapState.map.data,[0,1,0,1]);assert.ok(mapState.count>0&&mapState.count<8000);record('Grayscale PNG upload becomes a bounded density map',{width:mapState.map.width,height:mapState.map.height,count:mapState.count});
  await openDetails(grassSection());await openDetails(grassAdvanced());await grassAdvanced().getByRole('button',{name:'Clear density map',exact:true}).click();
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.layers.grass.densityMap===null);record('Density map can be cleared');
  await page.evaluate(async grass=>{await window.__EZ_ENVIRONMENT__.environment.setOptions({layers:{grass}});window.__EZ_ENVIRONMENT__.studio.renderPanel();},originalGrass);
  await page.locator('#studio-panel').getByLabel('Terrain height · m',{exact:true}).fill('4');await page.locator('#studio-panel').getByLabel('Terrain height · m',{exact:true}).press('Tab');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.terrain.amplitude===4);
  const terrainSamples=await page.evaluate(async()=>{
    const {terrainHeight}=await import('/environment/placement.js');const app=window.__EZ_ENVIRONMENT__,e=app.environment,ray=app.studio.raycaster,down=app.camera.position.clone().set(0,-1,0),origin=app.camera.position.clone();e.ground.updateMatrixWorld(true);
    const records=[...e.placement.chunks.values()].flatMap(c=>c.layers.grass.records.slice(0,1));let maximumError=0,hits=0;
    for(const record of records){const[x,,z]=record.position;origin.set(x,100,z);ray.set(origin,down);const hit=ray.intersectObject(e.ground)[0];if(hit){hits++;maximumError=Math.max(maximumError,Math.abs(hit.point.y+.015-terrainHeight(x,z,e.options)));}}
    return{hits,maximumError,expected:records.length};
  });assert.equal(terrainSamples.hits,terrainSamples.expected);assert.ok(terrainSamples.maximumError<.02);record('Rendered terrain matches analytic placement heights',terrainSamples);await screenshot('environment-terrain');
  await page.locator('#studio-panel').getByLabel('Terrain height · m',{exact:true}).fill('0');await page.locator('#studio-panel').getByLabel('Terrain height · m',{exact:true}).press('Tab');await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.terrain.amplitude===0);
  const stable=await page.evaluate(async()=>{const e=window.__EZ_ENVIRONMENT__.environment,before=e.placement.hash;await e.regenerate();return{before,after:e.placement.hash,stats:e.stats};});
  assert.equal(stable.before,stable.after);record('Environment regeneration preserves placement',stable);
  const lodState=await page.evaluate(()=>{
    const app=window.__EZ_ENVIRONMENT__,e=app.environment;
    window.__lodTest={position:app.camera.position.clone(),target:app.controls.target.clone(),enabled:app.controls.enabled,versions:new Map()};
    e.traverse(o=>{if(o.isInstancedMesh)window.__lodTest.versions.set(o,[o.instanceMatrix.version,o.instanceMatrix.array]);});
    app.controls.enabled=false;return{key:e.batches.has('0:0')?'0:0':e.batches.keys().next().value};
  });
  const transitionRows=[];
  for(const [distance,mask]of [[42,1],[44,3],[48,3],[52,3],[54,2],[94,2],[96,6],[100,6],[104,6],[106,4]]){
    const state=await page.evaluate(({key,distance})=>{
      const app=window.__EZ_ENVIRONMENT__,b=app.environment.batches.get(key);
      app.camera.position.set(b.center.x+Math.sqrt(distance*distance-144),12,b.center.z);app.controls.target.copy(b.center).y=1;app.controls.update();
      app.environment.update(4,app.camera);app.render();
      return{distance,mask:b.mask,visible:b.levels.map(level=>level.group.visible),programs:app.renderer.info.programs.length};
    },{key:lodState.key,distance});
    assert.equal(state.mask,mask);transitionRows.push(state);
    if(distance===48||distance===100)await screenshot(`environment-lod-transition-${distance}m`);
  }
  const lodVerification=await page.evaluate(()=>{
    const app=window.__EZ_ENVIRONMENT__,e=app.environment,saved=window.__lodTest;
    let unchanged=true,windDepth=0,sharedMaterials=new Set();
    e.traverse(o=>{if(o.isInstancedMesh){const old=saved.versions.get(o);if(old[0]!==o.instanceMatrix.version||old[1]!==o.instanceMatrix.array)unchanged=false;sharedMaterials.add(o.material);if(o.castShadow&&o.name.startsWith('plants_')&&o.customDepthMaterial?.customProgramCacheKey().includes('ez-wind'))windDepth++;}});
    app.camera.position.copy(saved.position);app.controls.target.copy(saved.target);app.controls.enabled=saved.enabled;app.controls.update();delete window.__lodTest;
    return{unchanged,windDepth,sharedMaterials:sharedMaterials.size,sources:e.lod.sources.size,programsValid:app.renderer.info.programs.every(program=>program.diagnostics?.runnable!==false)};
  });
  assert.ok(lodVerification.unchanged&&lodVerification.windDepth>0&&lodVerification.programsValid);assert.ok(lodVerification.sharedMaterials<=lodVerification.sources*3);
  record('Compiled dither LOD transitions and matching wind shadows preserve instance buffers',{transitionRows,...lodVerification});
  const disposedInitialize=await page.evaluate(async()=>{
    const {EnvironmentController}=await import('/environment/EnvironmentController.js');const {createRegistry}=await import('/environment/species.js');
    const environment=new EnvironmentController({radius:16,chunkSize:16,quality:'low'});environment.registry=await createRegistry([],environment.cache,false);
    const first=environment.initialize(),second=environment.initialize();const shared=first===second;environment.dispose();
    let rejected=false;try{await first;}catch(error){rejected=/dispos|cancel/i.test(error.message);}
    return{shared,rejected,ready:environment.ready,loading:environment.loading,registry:environment.registry.size,wind:environment.wind.materials.size,lod:environment.lod.sources.size};
  });
  assert.ok(disposedInitialize.shared&&disposedInitialize.rejected);assert.equal(disposedInitialize.ready,false);assert.equal(disposedInitialize.loading,false);assert.equal(disposedInitialize.registry,0);assert.equal(disposedInitialize.wind,0);assert.equal(disposedInitialize.lod,0);
  record('Concurrent initialization shares one promise and disposal cancels readiness',disposedInitialize);
  const fixtureDownload=page.waitForEvent('download',{timeout:60000});
  const fixtureDetails=await page.evaluate(async()=>{
    const {exportScenePack}=await import('/export/exporters.js');const {hash}=await import('/environment/random.js');
    const app=window.__EZ_ENVIRONMENT__,source=app.environment;
    const placement=structuredClone(source.placement);
    for(const chunk of placement.chunks.values())for(const layer of Object.values(chunk.layers))layer.records=layer.records.slice(0,1);
    const plantChunk=[...placement.chunks.values()].find(chunk=>chunk.layers.plants.records.length);
    const fern=structuredClone(plantChunk.layers.plants.records[0]);fern.species='fern';fern.position[0]+=.4;plantChunk.layers.plants.records.push(fern);
    const flowerChunk=[...placement.chunks.values()].find(chunk=>chunk.layers.flowers.records.length);
    const flower=structuredClone(flowerChunk.layers.flowers.records[0]);flower.species='flower_white';flower.position[0]+=.5;flowerChunk.layers.flowers.records.push(flower);
    placement.hash=hash([...placement.chunks.values()]);
    const fixture={...source,placement,loading:false,exportObjects:[{id:'hero-tree',object:app.tree}]};
    const result=await exportScenePack(fixture,[app.tree,...app.forest.children],{name:'unity-fixture',treeColliders:true});
    return{assets:result.manifest.assets.map(asset=>asset.id),chunks:result.manifest.chunks.length,instances:result.manifest.chunks.reduce((sum,chunk)=>sum+chunk.count,0),staticObjects:result.manifest.staticObjects};
  });
  const fixturePath=path.join(output,'unity-fixture.zip');await(await fixtureDownload).saveAs(fixturePath);
  const fixtureFiles=unzipSync(new Uint8Array(await readFile(fixturePath)));
  for(const [relative,bytes]of Object.entries(fixtureFiles)){
    const target=path.resolve(output,'unity-fixture',relative);assert.ok(target.startsWith(path.resolve(output,'unity-fixture')+path.sep));
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);
  }
  record('Export real browser Unity fixture',{...fixtureDetails,path:fixturePath,files:Object.keys(fixtureFiles).length});
  const beforeMemory=await page.evaluate(()=>({...window.__EZ_ENVIRONMENT__.renderer.info.memory}));
  for(let i=0;i<5;i++){await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.setMode('plant');await s.setMode('rock');await s.setMode('environment');});}
  const afterMemory=await page.evaluate(()=>({...window.__EZ_ENVIRONMENT__.renderer.info.memory}));
  record('Five mode switching cycles complete',{beforeMemory,afterMemory});
  for(const [kind,form,layer]of [['plant','fern','plants'],['rock','boulder','boulders']]){
    await mode(kind);await page.locator('#studio-panel').getByLabel('Form',{exact:true}).selectOption(form);
    await page.waitForFunction(value=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definition.archetype===value,form);
    const hash=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.asset.definitionHash);
    await page.locator('#studio-panel').getByRole('button',{name:'Add to environment',exact:true}).click();
    await page.waitForFunction(({layer,hash})=>{const app=window.__EZ_ENVIRONMENT__;return app.mode==='environment'&&!app.environment.loading&&app.environment.options.layers[layer].species.includes(hash);},{layer,hash});
    const integration=await page.evaluate(layer=>{const e=window.__EZ_ENVIRONMENT__.environment,id=e.options.layers[layer].species;return{id,registered:e.registry.has(id),custom:e.options.customSpecies.some(s=>s.id===id),count:e.placement.count[layer],recordsMatch:[...e.placement.chunks.values()].every(c=>c.layers[layer].records.every(r=>r.species===id))};},layer);
    assert.ok(integration.registered&&integration.custom&&integration.recordsMatch&&integration.count>0);record(`${form} asset integrates into environment ${layer} layer`,integration);
  }
  await screenshot('environment-custom-assets');
  await page.locator('#studio-panel summary').filter({hasText:'Paint density & exclusions'}).click();
  await page.locator('#studio-panel').getByLabel('Brush enabled',{exact:true}).check();
  await page.locator('#studio-panel').getByLabel('Brush radius · m',{exact:true}).fill('12');await page.locator('#studio-panel').getByLabel('Brush radius · m',{exact:true}).press('Tab');
  const beforePaint=await page.evaluate(()=>({hash:window.__EZ_ENVIRONMENT__.environment.placement.hash,brushes:window.__EZ_ENVIRONMENT__.environment.options.brushes.length,exclusions:window.__EZ_ENVIRONMENT__.environment.options.exclusions.length}));
  const canvas=await page.locator('#app canvas').boundingBox();
  const paintTerrain=async()=>{await page.keyboard.down('Shift');await page.mouse.click(canvas.x+canvas.width*.38,canvas.y+canvas.height*.61);await page.keyboard.up('Shift');};
  await paintTerrain();
  await page.waitForFunction(count=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.brushes.length===count+1,beforePaint.brushes);
  assert.notEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.environment.placement.hash),beforePaint.hash);record('Shift-click terrain paints a density mask');
  await page.locator('#studio-panel').getByRole('button',{name:'Undo last paint stroke',exact:true}).click();
  await page.waitForFunction(hash=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.placement.hash===hash,beforePaint.hash);record('Undo paint restores deterministic placement');
  await page.locator('#studio-panel').getByLabel('Operation',{exact:true}).selectOption('path');await paintTerrain();
  await page.waitForFunction(count=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.options.exclusions.length===count+1,beforePaint.exclusions);record('Shift-click can exclude every layer');
  await page.locator('#studio-panel').getByRole('button',{name:'Clear painted masks',exact:true}).click();
  await page.waitForFunction(hash=>!window.__EZ_ENVIRONMENT__.environment.loading&&window.__EZ_ENVIRONMENT__.environment.placement.hash===hash,beforePaint.hash);record('Clear masks restores the unpainted world');
  const borderPaint=await page.evaluate(async()=>{
    const {generatePlacement}=await import('/environment/placement.js');const {hash}=await import('/environment/random.js');
    const e=window.__EZ_ENVIRONMENT__.environment,before=new Map([...e.batches].map(([key,batch])=>[key,batch.root.uuid])),oldChunks=new Map([...e.placement.chunks].map(([key,chunk])=>[key,hash(chunk)]));
    await e.paint({type:'circle',x:e.options.chunkSize-.25,z:20,radius:8,strength:-1,layer:'boulders'});
    const fresh=generatePlacement(e.options);let untouched=0,changed=0,untouchedStable=true;
    for(const [key,batch]of e.batches){if(before.get(key)===batch.root.uuid){untouched++;if(oldChunks.get(key)!==hash(e.placement.chunks.get(key)))untouchedStable=false;}else changed++;}
    const result={matchesFresh:fresh.hash===e.placement.hash,untouched,changed,untouchedStable};e.options.brushes.pop();await e.regenerate();return result;
  });
  assert.ok(borderPaint.matchesFresh&&borderPaint.untouchedStable&&borderPaint.untouched>0&&borderPaint.changed>0);record('Boulder border painting updates its halo while preserving untouched chunk batches',borderPaint);
  const reloadCaches=await page.evaluate(async()=>{
    const app=window.__EZ_ENVIRONMENT__,s=app.studio,project=structuredClone(s.project());
    const sizes=[];
    for(let i=0;i<5;i++){await s.loadProject(project);app.render();sizes.push({wind:app.environment.wind.materials.size,lod:app.environment.lod.sources.size,geometries:app.renderer.info.memory.geometries,textures:app.renderer.info.memory.textures});}
    return sizes;
  });
  for(const sizes of reloadCaches.slice(1))assert.deepEqual(sizes,reloadCaches[0]);record('Custom project reloads do not grow shader bindings or renderer resources',{cycles:reloadCaches});
  await mode('tree');
  for(const presetName of ['Ash Medium','Pine Medium']){
    await page.locator('#ui-container [data-tab="parameters"]').click();
    await page.locator('#tab-parameters select').first().selectOption(presetName);
    await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.fit());
    await page.waitForFunction(()=>{const tree=window.__EZ_ENVIRONMENT__.tree;return tree.leavesMesh.material.map?.image?.width>0;});
    const counts=[];
    for(const lod of ['Full','LOD1','LOD2']){
      await page.locator('.lod-switcher').getByRole('button',{name:lod,exact:true}).click();
      counts.push(await page.evaluate(()=>{let count=0;window.__EZ_ENVIRONMENT__.tree.traverse(o=>{if(o.geometry)count+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});return count;}));
    }
    assert.ok(counts[0]>counts[1]&&counts[1]>counts[2]);record(`${presetName} tree LOD preview`,{counts});
    await page.locator('.lod-switcher').getByRole('button',{name:'Full',exact:true}).click();
    await screenshot(`tree-${presetName.replaceAll(' ','-').toLowerCase()}`);
    await page.locator('#ui-container [data-tab="export"]').click();
    const stem=presetName.replaceAll(' ','-').toLowerCase();
    const treeGLB=await download('Export GLB (Full Detail)',`${stem}.glb`,page.locator('#ui-container'));
    const info=assertGLB(treeGLB.bytes);assert.ok(info.meshes?.length>0&&info.images?.length>0);record(`${presetName} original tree GLB export`,{bytes:treeGLB.bytes.length,meshes:info.meshes.length,images:info.images.length});
    const treePack=await download('Export LODs (ZIP)',`${stem}-lods.zip`,page.locator('#ui-container'));
    const treeFiles=unzipSync(new Uint8Array(treePack.bytes));const levels=Object.keys(treeFiles).filter(key=>key.endsWith('.glb'));assert.equal(levels.length,3);for(const key of levels)assertGLB(Buffer.from(treeFiles[key]));record(`${presetName} original tree LOD ZIP export`);
    const visibility=await page.evaluate(()=>{const result={};window.__EZ_ENVIRONMENT__.scene.traverse(o=>result[o.uuid]=o.visible);return result;});
    const png=await download('Export PNG',`${stem}.png`,page.locator('#ui-container'));assert.equal(png.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const afterPNG=await page.evaluate(()=>{const result={};window.__EZ_ENVIRONMENT__.scene.traverse(o=>result[o.uuid]=o.visible);return result;});assert.deepEqual(afterPNG,visibility);record(`${presetName} original tree PNG export preserves scene visibility`,{bytes:png.bytes.length});
  }
  const treeWind=await page.evaluate(async()=>{
    const {updateTreeWind}=await import('/environment/wind.js');const app=window.__EZ_ENVIRONMENT__,e=app.environment,old=structuredClone(e.options.wind);
    e.options.wind={...old,strength:0};e.update(3,app.camera);updateTreeWind(app.tree,e.wind,app.camera,3);const uniforms=app.tree.leavesMesh.material.userData.shader.uniforms,stopped=uniforms.uWindStrength.value.length();
    e.options.wind={...old,strength:.55,gustStrength:0,frequency:2,spatialScale:512,direction:[1,0]};e.update(3,app.camera);updateTreeWind(app.tree,e.wind,app.camera,3);
    const result={stopped,strength:uniforms.uWindStrength.value.length(),frequency:uniforms.uWindFrequency.value,spatialScale:uniforms.uWindScale.value};e.options.wind=old;e.update(3,app.camera);updateTreeWind(app.tree,e.wind,app.camera,3);return result;
  });assert.equal(treeWind.stopped,0);assert.ok(Math.abs(treeWind.strength-.55)<1e-6);assert.equal(treeWind.frequency,4);assert.equal(treeWind.spatialScale,512);record('Tree shader follows the shared environment wind controls',treeWind);
  assert.deepEqual(report.errors,[],'App must have no uncaught JavaScript errors.');
  assert.deepEqual(report.consoleErrors,[],'App must have no console errors.');
  assert.deepEqual(report.externalRequests,[],'Local desktop runtime must make no external requests.');
  report.passed=true;
}catch(error){
  report.passed=false;report.failure=error.stack||error.message;console.error(report.failure);
  if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  process.exitCode=1;
}finally{
  report.finishedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();if(server)server.kill();
}
