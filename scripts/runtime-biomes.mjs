// Run after scene/UI integration is complete, with no other GPU benchmark active.
// EZ_TEST_URL points at an existing server; EZ_BIOME_BENCH=0 skips performance runs.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'artifacts','biomes',new Date().toISOString().replaceAll(':','-'));
const thumbs=path.join(root,'src','app','public','images','biomes');
await mkdir(output,{recursive:true});await mkdir(thumbs,{recursive:true});
const url=process.env.EZ_TEST_URL||'http://127.0.0.1:5181';
const benchmark=process.env.EZ_BIOME_BENCH!=='0';
const report={startedAt:new Date().toISOString(),url,output,benchmark,protocol:{resolution:[1920,1080],dpr:1,quality:'medium',warmupMs:5000,measurementMs:10000,metric:'requestAnimationFrame full-scene frame intervals during a fixed camera replay; includes CPU and display scheduling, not GPU-only time',targets:{naturalistic:16.7,photorealistic:33.3}},checks:[],cases:[],screenshots:[],errors:[],consoleErrors:[],externalRequests:[]};
let browser,page,server,serverOutput='';
if(!process.env.EZ_TEST_URL){
  server=spawn(process.execPath,[path.join(root,'node_modules','vite','bin','vite.js'),'--config','vite.app.config.js','--host','127.0.0.1','--port','5181','--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data=>serverOutput+=data);server.stderr.on('data',data=>serverOutput+=data);
}
const checkpoint=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
const record=async(name,data={})=>{report.checks.push({name,passed:true,...data});console.log(`PASS ${name}`);await checkpoint();};
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const ready=()=>page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready&&!window.__EZ_ENVIRONMENT__.environment.loading,null,{timeout:120000});
try{
  for(let i=0;i<100;i++){
    try{if((await fetch(url)).ok)break;}catch{}
    if(i===99)throw new Error(`Server unavailable: ${serverOutput}`);
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  browser=await chromium.launch({channel:process.env.EZ_TEST_BROWSER||'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling']});
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
  page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(url))report.externalRequests.push(request.url());});
  await page.goto(url,{waitUntil:'networkidle'});await ready();
  await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.setMode('environment'));await frame();
  report.hardware=await page.evaluate(()=>{const gl=window.__EZ_ENVIRONMENT__.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return{userAgent:navigator.userAgent,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR)};});
  await record('Initialized environment workspace',await page.evaluate(()=>({mode:window.__EZ_ENVIRONMENT__.mode,biome:window.__EZ_ENVIRONMENT__.environment.options.biome})));

  const beforeWidth=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.renderer.domElement.width);
  await page.locator('#inspector-resize').focus();await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(before=>window.__EZ_ENVIRONMENT__.renderer.domElement.width<before,beforeWidth);
  const resized=await page.evaluate(()=>{const a=window.__EZ_ENVIRONMENT__,r=a.renderer.domElement,rect=r.getBoundingClientRect();return{width:r.width,height:r.height,cssWidth:rect.width,cssHeight:rect.height,aspect:a.camera.aspect};});
  assert.equal(resized.width,Math.round(resized.cssWidth));assert.equal(resized.height,Math.round(resized.cssHeight));assert.equal(resized.aspect,resized.cssWidth/resized.cssHeight);
  await page.getByRole('button',{name:'Clean view',exact:true}).click();
  await page.waitForFunction(width=>window.__EZ_ENVIRONMENT__.renderer.domElement.width>width,resized.width);
  await page.getByRole('button',{name:'Show inspector',exact:true}).click();await frame();
  await record('Inspector resize and clean view resize the actual canvas and camera aspect',resized);
  const divider=await page.locator('#inspector-resize').boundingBox();
  await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2);await page.mouse.down();
  await page.mouse.move(divider.x+divider.width/2-60,divider.y+divider.height/2,{steps:8});await page.mouse.up();
  await page.waitForFunction(width=>window.__EZ_ENVIRONMENT__.renderer.domElement.width<width-40,resized.width);
  await record('Inspector divider dragging resizes the viewport');

  const paintTarget=await page.evaluate(()=>{
    const a=window.__EZ_ENVIRONMENT__,s=a.studio;s.cameraPreset('top');s.brush.enabled=true;s.brush.radius=5;s.brush.strength=-1;s.brush.layer='grass';s.updateViewportToolbar();
    const rect=a.renderer.domElement.getBoundingClientRect();s.pointer.set(.1,.04);s.raycaster.setFromCamera(s.pointer,a.camera);const hit=s.raycaster.intersectObject(a.environment.ground)[0];
    return {x:rect.left+rect.width*.55,y:rect.top+rect.height*.48,world:hit.point.toArray(),before:a.environment.options.brushes.length};
  });
  await page.mouse.move(paintTarget.x,paintTarget.y);await frame();
  const outline=await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio,p=s.brushOutline.geometry.attributes.position;let x=0,z=0;for(let i=0;i<p.count;i++){x+=p.getX(i);z+=p.getZ(i);}return{visible:s.brushOutline.visible,indicator:!document.getElementById('paint-indicator').hidden,x:x/p.count,z:z/p.count};});
  assert.equal(outline.visible,true);assert.equal(outline.indicator,true);assert.ok(Math.abs(outline.x-paintTarget.world[0])<.01&&Math.abs(outline.z-paintTarget.world[2])<.01);
  await page.keyboard.down('Shift');await page.mouse.click(paintTarget.x,paintTarget.y);await page.keyboard.up('Shift');
  await page.waitForFunction(count=>{const e=window.__EZ_ENVIRONMENT__.environment;return !e.loading&&e.options.brushes.length===count+1;},paintTarget.before);
  const paintedStroke=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.environment.options.brushes.at(-1));
  assert.ok(Math.abs(paintedStroke.x-paintTarget.world[0])<.01&&Math.abs(paintedStroke.z-paintTarget.world[2])<.01);
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.undo();s.brush.enabled=false;s.updateViewportToolbar();});
  await record('Resized viewport brush preview and shift-click paint align with the terrain raycast');

  const cameraModes=await page.evaluate(async()=>{
    const s=window.__EZ_ENVIRONMENT__.studio;s.cameraPreset('ground');const environment=s.cameraState();
    await s.setMode('plant');s.cameraPreset('top');const plant=s.cameraState();
    await s.setMode('rock');s.cameraPreset('ground');const rock=s.cameraState();
    await s.setMode('plant');const plantAfter=s.cameraState();await s.setMode('rock');const rockAfter=s.cameraState();await s.setMode('environment');const environmentAfter=s.cameraState();
    return{environment,plant,rock,environmentAfter,plantAfter,rockAfter};
  });
  for(const mode of ['environment','plant','rock']){
    for(const key of ['near','far','zoom'])assert.equal(cameraModes[mode][key],cameraModes[`${mode}After`][key]);
    for(const key of ['position','target'])cameraModes[mode][key].forEach((value,i)=>assert.ok(Math.abs(value-cameraModes[`${mode}After`][key][i])<1e-9,`${mode} ${key}`));
  }
  await record('Plant, Rock and Environment keep independent camera states across revisits');

  // Abort a real first-use texture request, then retry after removing the route.
  const failedTexture='**/textures/biomes/dune-sand/color-2048.jpg';
  await page.route(failedTexture,route=>route.abort('failed'));
  const rollback=await page.evaluate(async()=>{
    const a=window.__EZ_ENVIRONMENT__,e=a.environment;
    const {applyBiome}=await import('/environment/biomes.js');
    const before={options:JSON.stringify(e.options),hash:e.placement.hash,ground:e.ground.uuid,content:e.content.children.map(o=>o.uuid)};
    let error=null;try{await e.setOptions({...applyBiome(e.options,'desert'),appearance:'photorealistic'});}catch(failure){error=failure.message;}
    return {before,after:{options:JSON.stringify(e.options),hash:e.placement.hash,ground:e.ground.uuid,content:e.content.children.map(o=>o.uuid)},error};
  });
  await page.unroute(failedTexture);
  assert.match(rollback.error||'',/dune-sand/);assert.deepEqual(rollback.after,rollback.before);
  await record('Failed material load retains the previous options and usable scene');

  // Capture the real app renderer: no illustrated or generated thumbnail substitutes.
  const capture=async(size,file)=>{
    const data=await page.evaluate(async(size)=>{
      const a=window.__EZ_ENVIRONMENT__,r=a.renderer,c=a.camera;
      const state=()=>({width:r.domElement.width,height:r.domElement.height,dpr:r.getPixelRatio(),aspect:c.aspect,zoom:c.zoom,position:c.position.toArray(),projection:c.projectionMatrix.toArray(),scissor:r.getScissorTest(),target:a.controls.target.toArray(),renderTarget:r.getRenderTarget()?.uuid??null});
      const before=state(),blob=await a.capturePNG(size,{download:false}),after=state();
      const bitmap=await createImageBitmap(blob),dimensions=[bitmap.width,bitmap.height];bitmap.close();
      const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
      return {before,after,dimensions,base64};
    },size);
    // Image encoding yields to RAF; OrbitControls can round stationary spherical
    // coordinates by a few ulps during that time. Keep renderer checks exact.
    for(const key of ['position','target']){
      data.before[key].forEach((value,i)=>assert.ok(Math.abs(data.after[key][i]-value)<1e-9,`${size} capture restores camera ${key}`));
    }
    const {position:beforePosition,target:beforeTarget,...beforeRenderer}=data.before;
    const {position:afterPosition,target:afterTarget,...afterRenderer}=data.after;
    assert.deepEqual(afterRenderer,beforeRenderer,`${size} capture must restore renderer and projection state`);
    if(size!=='viewport')assert.deepEqual(data.dimensions,size==='4k'?[3840,2160]:[1920,1080]);
    await writeFile(file,Buffer.from(data.base64,'base64'));return{file,dimensions:data.dimensions};
  };
  for(const biome of ['forest','desert','meadow','rocky']){
    let referenceHash=null,referenceTrees=null;
    for(const appearance of ['naturalistic','photorealistic']){
      console.log(`CASE ${biome} ${appearance}`);
      await page.evaluate(async({biome,appearance})=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.applyBiomePreset(biome);await s.envChange({appearance,quality:'medium'},{modified:false});s.cameraPreset('overview');},{biome,appearance});
      await ready();await frame();
      const result=await page.evaluate(()=>{const a=window.__EZ_ENVIRONMENT__,e=a.environment;return{biome:e.options.biome,appearance:e.options.appearance,hash:e.placement.hash,count:e.placement.count,trees:e.grove.records?.length??null,groveTransforms:e.grove.records??null,heroVisible:a.tree.visible,legacyForestVisible:a.forest.visible,resources:{...a.renderer.info.memory}};});
      assert.equal(result.biome,biome);assert.equal(result.appearance,appearance);assert.equal(result.heroVisible,false);assert.equal(result.legacyForestVisible,false);
      if(referenceHash===null){referenceHash=result.hash;referenceTrees=result.groveTransforms;}else{assert.equal(result.hash,referenceHash);assert.deepEqual(result.groveTransforms,referenceTrees);}
      const overview=await capture('1080p',path.join(output,`${biome}-${appearance}-overview.png`));report.screenshots.push(overview);
      if(appearance==='naturalistic'){
        const jpg=await page.evaluate(()=>{const a=window.__EZ_ENVIRONMENT__;a.render();const source=a.renderer.domElement,canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;const cropHeight=Math.min(source.height,source.width*9/16),cropWidth=cropHeight*16/9;canvas.getContext('2d').drawImage(source,(source.width-cropWidth)/2,(source.height-cropHeight)/2,cropWidth,cropHeight,0,0,480,270);return canvas.toDataURL('image/jpeg',.88).split(',')[1];});
        await writeFile(path.join(thumbs,`${biome}.jpg`),Buffer.from(jpg,'base64'));
      }
      await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.cameraPreset('ground'));await frame();
      report.screenshots.push(await capture('1080p',path.join(output,`${biome}-${appearance}-ground.png`)));
      if(benchmark){
        await page.evaluate(()=>{const container=document.getElementById('app');window.__EZ_BIOME_SAVED_STYLE__=container.style.cssText;container.style.cssText='position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:1920px!important;height:1080px!important;max-width:none!important;max-height:none!important;';});
        await page.waitForFunction(()=>{const c=window.__EZ_ENVIRONMENT__.renderer.domElement;return c.width===1920&&c.height===1080;});
        result.performance=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.runBenchmark({duration:10000,warmup:5000,replay:true}));
        assert.deepEqual(result.performance.resolution,[1920,1080]);assert.equal(result.performance.dpr,1);
        result.performance.targetMs=report.protocol.targets[appearance];result.performance.targetMet=result.performance.frameMs.p95<=result.performance.targetMs;
        console.log(`BENCH ${biome} ${appearance} p95 ${result.performance.frameMs.p95.toFixed(2)}ms / ${result.performance.targetMs}ms`);
        await page.evaluate(()=>{document.getElementById('app').style.cssText=window.__EZ_BIOME_SAVED_STYLE__;delete window.__EZ_BIOME_SAVED_STYLE__;});await frame();
      }
      report.cases.push(result);await record(`${biome} ${appearance}: cameras, appearance, PNG restoration and deterministic placement`);
    }
  }

  const workspaceFile=path.join(output,'workspace.png');await page.screenshot({path:workspaceFile});report.screenshots.push({file:workspaceFile});
  report.screenshots.push(await capture('4k',path.join(output,'rocky-photorealistic-4k.png')));
  await record('4K PNG dimensions and renderer state restoration');

  const persistence=await page.evaluate(async()=>{
    const a=window.__EZ_ENVIRONMENT__,s=a.studio;
    await s.applyBiomePreset('forest');s.cameraPreset('ground');
    const brush={type:'circle',x:10,z:10,radius:5,layer:'grass',strength:-1};
    const before=structuredClone(a.environment.options.brushes);await s.envChange({brushes:[...before,brush]});
    const painted=structuredClone(a.environment.options.brushes);await s.undo();const undone=structuredClone(a.environment.options.brushes);await s.redo();const redone=structuredClone(a.environment.options.brushes);
    s.cameras.bookmarks[0]={mode:s.mode,camera:s.cameraState()};
    const saved=JSON.parse(JSON.stringify(s.project())),hash=a.environment.placement.hash;
    await s.applyBiomePreset('desert');await s.loadProject(saved);
    return {before,painted,undone,redone,saved,restored:JSON.parse(JSON.stringify(s.project())),hash,restoredHash:a.environment.placement.hash};
  });
  assert.deepEqual(persistence.undone,persistence.before);assert.deepEqual(persistence.redone,persistence.painted);
  assert.equal(persistence.saved.version,2);assert.deepEqual(persistence.restored,persistence.saved);assert.equal(persistence.restoredHash,persistence.hash);
  await writeFile(path.join(output,'saved-project-v2.json'),JSON.stringify(persistence.saved,null,2));
  await record('Undo/redo painting and version 2 project round-trip restore scene, masks and cameras');

  const sourceTransaction=await page.evaluate(async()=>{
    const a=window.__EZ_ENVIRONMENT__,s=a.studio,e=a.environment,saved=structuredClone(s.project());
    const incoming=structuredClone(saved);incoming.tree.branch.radius[0]=3.8;incoming.environment.includeAuthoredTree=true;
    await s.loadProject(incoming);
    const source=e.options.treeExclusions.find(item=>item.source==='scene-tree');
    const placementSource=e.placement.options.treeExclusions.find(item=>item.source==='scene-tree');
    const before={project:JSON.stringify(s.project()),ground:e.ground.uuid,hash:e.placement.hash,branches:a.tree.branchesMesh.geometry.uuid};
    const next=structuredClone(s.project());next.tree.seed=(next.tree.seed+7)%65536;
    const create=e.createGround;let error;
    e.createGround=()=>{throw new Error('Injected project staging failure');};
    try{await s.loadProject(next);}catch(failure){error=failure.message;}finally{e.createGround=create;}
    const after={project:JSON.stringify(s.project()),ground:e.ground.uuid,hash:e.placement.hash,branches:a.tree.branchesMesh.geometry.uuid};
    await s.loadProject(saved);return{source,placementSource,before,after,error};
  });
  assert.equal(sourceTransaction.source.radius,3.8*1.3);assert.deepEqual(sourceTransaction.placementSource,sourceTransaction.source);
  assert.match(sourceTransaction.error,/project staging failure/);assert.deepEqual(sourceTransaction.after,sourceTransaction.before);
  await record('Authored tree sources reach project placement and failed project staging retains the live world');

  const exports=await page.evaluate(async()=>{
    const a=window.__EZ_ENVIRONMENT__,s=a.studio,e=a.environment;
    const {exportGLB,exportEnvironmentPack,validateManifest}=await import('/export/exporters.js');
    const tree=await exportGLB(a.tree,{maxTextureSize:256}),treeView=new DataView(tree);
    const saved=structuredClone(s.project());await s.applyBiomePreset('desert');await s.envChange({radius:24,appearance:'photorealistic'},{modified:false});
    const pack=await exportEnvironmentPack(e,{download:false,maxTextureSize:256});
    const validation=validateManifest(pack.manifest,pack.files);
    const result={treeMagic:treeView.getUint32(0,true),treeBytes:tree.byteLength,packBytes:pack.blob.size,validation,appearance:pack.manifest.presentation.appearance,assets:pack.manifest.assets.length,staticObjects:pack.manifest.staticObjects};
    await s.loadProject(saved);return result;
  });
  assert.equal(exports.treeMagic,0x46546c67);assert.ok(exports.treeBytes>20&&exports.packBytes>1000&&exports.assets>0);
  assert.equal(exports.validation.valid,true);assert.equal(exports.appearance,'photorealistic');assert.ok(exports.staticObjects.some(item=>item.id==='terrain'));
  await record('Real tree GLB and photographic Desert pack serialize valid bundled geometry and materials',exports);

  const legacy=await page.evaluate(async()=>{
    const a=window.__EZ_ENVIRONMENT__,s=a.studio;const {validateOptions}=await import('/environment/options.js');
    const project=structuredClone(s.project());project.version=1;delete project.cameras;
    project.environment=validateOptions({biome:'woodland',terrain:{amplitude:2},layers:{grass:{density:.123}}});
    await s.loadProject(project);
    const result={composition:a.environment.options.composition,density:a.environment.options.layers.grass.density,biome:a.environment.options.biome,amplitude:a.environment.options.terrain.amplitude};
    await s.applyBiomePreset('forest');return result;
  });
  assert.deepEqual(legacy,{composition:'legacy',density:.123,biome:'woodland',amplitude:2});
  await record('Version 1 project retains legacy terrain and layer settings until preset upgrade');

  const rapid=await page.evaluate(async()=>{
    const e=window.__EZ_ENVIRONMENT__.environment,{applyBiome}=await import('/environment/biomes.js');
    const baseline=structuredClone(e.options),before=e.ground.uuid;
    const requests=['forest','desert','meadow','rocky'].map(id=>e.setOptions(applyBiome(baseline,id)));
    const oldSceneRetained=e.ground.uuid===before;await Promise.all(requests);
    return{biome:e.options.biome,loading:e.loading,oldSceneRetained,hash:e.placement.hash};
  });
  assert.equal(rapid.biome,'rocky');assert.equal(rapid.loading,false);assert.equal(rapid.oldSceneRetained,true);
  await record('Rapid requests retain old scene while building and commit only the newest biome',rapid);

  const memory=await page.evaluate(async()=>{
    const a=window.__EZ_ENVIRONMENT__,e=a.environment,s=a.studio,cycles=[];
    for(let cycle=0;cycle<3;cycle++){
      for(const biome of ['forest','desert','meadow','rocky']){
        await s.applyBiomePreset(biome);await s.envChange({appearance:cycle%2?'photorealistic':'naturalistic'},{modified:false});a.render();
      }
      await s.applyBiomePreset('forest');await s.envChange({appearance:'naturalistic'},{modified:false});a.render();
      cycles.push({...a.renderer.info.memory,materialCache:e.biomeMaterials.cache.size,sceneChildren:e.children.length,ground:e.ground.uuid});
    }
    return cycles;
  });
  for(const key of ['geometries','textures','materialCache','sceneChildren'])assert.ok(memory[2][key]<=memory[1][key]+(key==='textures'?1:0),`${key} continues to grow after all biome assets are warm`);
  await record('Repeated biome/style switching has bounded renderer resources after warmup',{cycles:memory});
  assert.deepEqual(report.errors,[],'No uncaught page errors');assert.deepEqual(report.externalRequests,[],'All application assets are bundled locally');
  const shaderErrors=report.consoleErrors.filter(message=>/Shader Error|VALIDATE_STATUS|WebGLProgram: Shader Error|THREE.WebGLProgram/.test(message));
  assert.deepEqual(shaderErrors,[],'Shaders compile without renderer errors');
  await record('No uncaught application errors, shader compile errors, or remote asset requests');
  report.functionalPassed=true;
  report.performancePassed=benchmark?report.cases.every(item=>item.performance.targetMet):null;
}catch(error){report.functionalPassed=false;report.failure=error.stack||error.message;process.exitCode=1;console.error(report.failure);}
finally{report.completedAt=new Date().toISOString();await checkpoint();await browser?.close();server?.kill();console.log(`REPORT ${path.join(output,'report.json')}`);}
