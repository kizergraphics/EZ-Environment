import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'artifacts','runtime');
const url=process.env.EZ_TEST_URL||'http://127.0.0.1:5173';
const report={startedAt:new Date().toISOString(),checks:[],errors:[],consoleErrors:[]};
const server=process.env.EZ_TEST_URL?null:spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--config','vite.app.config.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd:root,windowsHide:true,stdio:'ignore'});
let browser;
const record=(name,data)=>{report.checks.push({name,passed:true,...data});console.log(`PASS ${name}`);};
try{
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok)break;}catch{}if(i===79)throw new Error('Vite startup timed out.');await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,{timeout:60000});
  const recovery=await page.evaluate(async()=>{
    const s=window.__EZ_ENVIRONMENT__.studio;await s.setMode('plant');const seed=s.definitions.plant.seed;s.definitions.plant.seed=NaN;
    let error;try{await s.generate();}catch(e){error=e.message;}
    const clean=s.pending===null&&s.client.pending===null&&s.client.worker===null;
    s.definitions.plant.seed=seed;await s.ensureAsset();
    return{error,clean,recovered:s.asset?.definition.seed===seed&&!s.pending};
  });
  assert.ok(recovery.error&&recovery.clean&&recovery.recovered);record('Worker rejection clears pending and ensureAsset recovers',recovery);

  await page.getByRole('button',{name:'Add to environment',exact:true}).click();
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__.studio.mode==='environment'&&!window.__EZ_ENVIRONMENT__.environment.loading);
  const id=await page.evaluate(async()=>{
    const app=window.__EZ_ENVIRONMENT__,e=app.environment,id=e.options.layers.plants.species;
    await e.setOptions({layers:{plants:{...e.options.layers.plants,speciesChoices:[{id,weight:1},{id:'fern',weight:1}]}}});
    await app.studio.setMode('plant');return id;
  });
  await page.getByRole('button',{name:'Add to environment',exact:true}).click();
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__.studio.mode==='environment'&&!window.__EZ_ENVIRONMENT__.environment.loading);
  const reused=await page.evaluate(id=>{const e=window.__EZ_ENVIRONMENT__.environment;return{same:e.options.layers.plants.species===id,mix:e.options.layers.plants.speciesChoices.length,records:[...e.placement.chunks.values()].flatMap(c=>c.layers.plants.records).every(r=>r.species===id),copies:e.options.customSpecies.filter(c=>c.id===id).length};},id);
  assert.ok(reused.same&&reused.records);assert.equal(reused.mix,0);assert.equal(reused.copies,1);record('Re-adding an existing custom asset clears the weighted mix',reused);

  const atomic=await page.evaluate(async()=>{
    const e=window.__EZ_ENVIRONMENT__.environment,options=e.options,placement=e.placement,ground=e.ground,roots=new Map([...e.batches].map(([k,b])=>[k,b.root])),create=e.createGround;
    e.createGround=()=>{throw new Error('Injected ground staging failure');};let error;
    try{await e.setOptions({terrain:{...options.terrain,amplitude:options.terrain.amplitude+1}});}catch(err){error=err.message;}finally{e.createGround=create;}
    return{error,options:e.options===options,placement:e.placement===placement,ground:e.ground===ground,roots:e.batches.size===roots.size&&[...e.batches].every(([k,b])=>roots.get(k)===b.root),loading:e.loading};
  });
  assert.match(atomic.error,/ground staging/);assert.ok(atomic.options&&atomic.placement&&atomic.ground&&atomic.roots&&!atomic.loading);record('Ground construction failure preserves the complete previous world',atomic);

  const observer=await page.evaluate(async()=>{
    const e=window.__EZ_ENVIRONMENT__.environment,oldGround=e.ground,original=e.onTerrainChanged,terrain={...e.options.terrain};
    e.onTerrainChanged=()=>{throw new Error('Injected observer failure');};
    await e.setOptions({terrain:{...terrain,amplitude:terrain.amplitude+1}});
    const result={error:e.error?.message,committed:e.ground!==oldGround,consistent:JSON.stringify(e.options)===JSON.stringify(e.placement.options),height:e.options.terrain.amplitude,loading:e.loading};
    e.onTerrainChanged=original;await e.setOptions({terrain});return result;
  });
  assert.match(observer.error,/observer failed/);assert.ok(observer.committed&&observer.consistent&&!observer.loading);record('Terrain observer failure is reported without undoing the committed world',observer);

  const palette=await page.evaluate(async()=>{
    const {collectMeshes}=await import('/environment/species.js');const e=window.__EZ_ENVIRONMENT__.environment;
    const grass={...e.options.layers.grass,species:'grass',speciesChoices:[{id:'grass',weight:1000000},{id:'grass_tall',weight:1e-12}],color:'#326c91',dryness:.7};
    await e.setOptions({layers:{grass}});
    const rare=e.registry.get('grass_tall'),parts=rare.lods.flatMap(l=>collectMeshes(l));
    const expected=parts[0].material.color.clone().set(grass.color).lerp(parts[0].material.color.clone().set('#b5a65f'),grass.dryness);
    const records=[...e.placement.chunks.values()].flatMap(c=>c.layers.grass.records);
    return{rareRecords:records.filter(r=>r.species==='grass_tall').length,parts:parts.length,allSourceColors:parts.every(p=>p.material.color.equals(expected)),allBoundColors:parts.every(p=>{const entry=e.lod.sources.get(p.material);return !entry||[...entry.levels.values()].every(b=>b.material.color.equals(expected));})};
  });
  assert.equal(palette.rareRecords,0);assert.ok(palette.parts>0&&palette.allSourceColors&&palette.allBoundColors);record('Unrendered rare weighted grass variants receive the selected palette',palette);

  const disposal=await page.evaluate(async()=>{
    const app=window.__EZ_ENVIRONMENT__,s=app.studio;await s.setMode('rock');app.render();await new Promise(r=>requestAnimationFrame(r));
    const shadow=app.environment.skybox.sun.shadow.map,ground=app.environment.ground;let shadowDisposals=0,groundDisposals=0;
    shadow?.addEventListener('dispose',()=>shadowDisposals++);ground.geometry.addEventListener('dispose',()=>groundDisposals++);
    const geometries=new Set();s.asset.lods.forEach(l=>l.traverse(o=>{if(o.geometry)geometries.add(o.geometry);}));let assetDisposals=0;
    geometries.forEach(g=>g.addEventListener('dispose',()=>assetDisposals++));
    const calls={fit:0,save:0,open:0,paint:0,generate:0,undo:0};
    s.fit=()=>calls.fit++;s.saveProject=()=>calls.save++;s.openFile=()=>calls.open++;s.paintAt=()=>calls.paint++;s.undo=()=>calls.undo++;
    s.change('seed',s.definitions.rock.seed+1);s.generate=async()=>{calls.generate++;};
    document.activeElement?.blur();s.dispose();s.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'f'}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true}));
    document.getElementById('save-project').click();document.getElementById('open-project').click();document.getElementById('fit-view').click();
    // Synthetic pointer events have no native pointer to capture. Keep the
    // unrelated OrbitControls handler from throwing during this listener probe.
    const canvas=app.renderer.domElement,capture=canvas.setPointerCapture;
    canvas.setPointerCapture=()=>{};
    try{canvas.dispatchEvent(new PointerEvent('pointerdown',{shiftKey:true,clientX:900,clientY:600}));}finally{canvas.setPointerCapture=capture;}
    await new Promise(r=>setTimeout(r,180));
    return{calls,shadowCreated:!!shadow,shadowDisposals,groundDisposals,assetDisposals,expectedAssetDisposals:geometries.size,previewDetached:!s.viewportGroup.parent,environmentStatusDetached:app.environment.onStatus===null,navButtons:document.querySelectorAll('[data-mode]').length,wind:s.previewWind.materials.size,asset:s.asset,worker:s.client.worker};
  });
  assert.deepEqual(disposal.calls,{fit:0,save:0,open:0,paint:0,generate:0,undo:0});assert.ok(disposal.shadowCreated&&disposal.previewDetached&&disposal.environmentStatusDetached);
  assert.equal(disposal.shadowDisposals,0);assert.equal(disposal.groundDisposals,0);assert.equal(disposal.assetDisposals,disposal.expectedAssetDisposals);assert.equal(disposal.navButtons,0);assert.equal(disposal.wind,0);assert.equal(disposal.asset,null);assert.equal(disposal.worker,null);record('Studio disposal releases owned resources and preserves the shared environment',disposal);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.kill();report.finishedAt=new Date().toISOString();await mkdir(output,{recursive:true});await writeFile(path.join(output,'recovery-report.json'),JSON.stringify(report,null,2));}
