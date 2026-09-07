// Set EZ_ALLOW_GPU_TEST=1 only after the isolated desktop benchmark/soak ends.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if(process.env.EZ_ALLOW_GPU_TEST!=='1')throw new Error('GPU test is paused. Wait for desktop GPU release, then set EZ_ALLOW_GPU_TEST=1.');
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'artifacts','runtime');
const url=process.env.EZ_TEST_URL||'http://127.0.0.1:5173';
const report={startedAt:new Date().toISOString(),checks:[],errors:[],consoleErrors:[],externalRequests:[]};
const server=process.env.EZ_TEST_URL?null:spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--config','vite.app.config.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd:root,windowsHide:true,stdio:'ignore'});
let browser,page;
const record=(name,data={})=>{report.checks.push({name,passed:true,...data});console.log(`PASS ${name}`);};
try{
  await mkdir(output,{recursive:true});
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok)break;}catch{}if(i===79)throw new Error('Vite startup timed out.');await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  page=await browser.newPage({viewport:{width:1920,height:1080},acceptDownloads:true});page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('request',request=>{const target=request.url();if(/^https?:/.test(target)&&!target.startsWith(url))report.externalRequests.push(target);});
  await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,{timeout:60000});
  // Exercise the original Tree + 24-tree backdrop workflow explicitly; new
  // workspaces now open in Meadow Environment mode without that legacy backdrop.
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio,p=structuredClone(s.project());p.version=1;p.mode='tree';delete p.cameras;await s.loadProject(p);});
  // Captured identity references live only in this isolated test browser.
  await page.evaluate(()=>{
    const app=window.__EZ_ENVIRONMENT__;
    window.__treeProof={snapshot(){const e=app.environment,t=app.tree;return{tree:t,options:t.options,definition:JSON.stringify(app.studio.project().tree),environmentOptions:e.options,placement:e.placement,ground:e.ground,branches:t.branchesMesh.geometry,leaves:t.leavesMesh.geometry,roots:new Map([...e.batches].map(([id,b])=>[id,b.root]))};},same(before){const e=app.environment,t=app.tree;return{tree:t===before.tree,options:t.options===before.options,definition:JSON.stringify(app.studio.project().tree)===before.definition,environmentOptions:e.options===before.environmentOptions,placement:e.placement===before.placement,ground:e.ground===before.ground,branches:t.branchesMesh.geometry===before.branches,leaves:t.leavesMesh.geometry===before.leaves,roots:e.batches.size===before.roots.size&&[...e.batches].every(([id,b])=>b.root===before.roots.get(id))};}};
  });
  const openProject=async object=>{const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open project',exact:true}).click();await(await chooser).setFiles({name:'tree-workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(object))});};
  const project=await page.evaluate(()=>{window.__treeProof.before=window.__treeProof.snapshot();return structuredClone(window.__EZ_ENVIRONMENT__.studio.project());});
  const invalid=structuredClone(project);invalid.tree.branch.start[1]=2;
  await openProject(invalid);
  await page.waitForFunction(()=>document.getElementById('studio-status').textContent.includes('Tree branch start 1'));
  const rejected=await page.evaluate(()=>window.__treeProof.same(window.__treeProof.before));
  assert.ok(Object.values(rejected).every(Boolean));record('Out-of-range tree project preserves exact live world and geometry identities',rejected);

  const valid=structuredClone(project);valid.tree.seed=(valid.tree.seed+37)%65536;
  await page.evaluate(()=>{
    const proof=window.__treeProof;proof.before=proof.snapshot();proof.disposals={branches:0,leaves:0};
    proof.before.branches.addEventListener('dispose',()=>proof.disposals.branches++);proof.before.leaves.addEventListener('dispose',()=>proof.disposals.leaves++);
  });
  await openProject(valid);await page.waitForFunction(()=>document.getElementById('studio-status').textContent==='Workspace restored.');
  const restored=await page.evaluate(seed=>{const app=window.__EZ_ENVIRONMENT__,proof=window.__treeProof,t=app.tree;return{sameTree:t===proof.before.tree,newBranches:t.branchesMesh.geometry!==proof.before.branches,newLeaves:t.leavesMesh.geometry!==proof.before.leaves,copy:typeof t.options.copy==='function',seed:t.options.seed,expectedSeed:seed,disposals:proof.disposals,textured:!!t.branchesMesh.material.map&&!!t.leavesMesh.material.map};},valid.tree.seed);
  assert.ok(restored.sameTree&&restored.newBranches&&restored.newLeaves&&restored.copy&&restored.textured);assert.equal(restored.seed,valid.tree.seed);assert.deepEqual(restored.disposals,{branches:1,leaves:1});record('Valid project atomically transfers geometry while retaining editable Tree identity',restored);

  await page.locator('#ui-container [data-tab="parameters"]').click();
  const immediate=await page.evaluate(()=>{
    const app=window.__EZ_ENVIRONMENT__,row=[...document.querySelectorAll('#tab-parameters .control-row')].find(r=>r.querySelector('.control-label')?.textContent==='Seed'),input=row.querySelector('input[type="number"]');
    const seed=(app.tree.options.seed+19)%65536;input.value=String(seed);input.dispatchEvent(new Event('change',{bubbles:true}));
    const saved=JSON.parse(localStorage.getItem('ez-environment-project-v2'));
    return{seed,live:app.tree.options.seed,saved:saved.tree.seed,mode:saved.mode,clean:!Object.hasOwn(saved.tree.bark,'maps')&&!Object.hasOwn(saved.tree.leaves,'map'),sourceCount:saved.environment.treeExclusions.filter(s=>s.source==='scene-tree').length};
  });
  assert.equal(immediate.live,immediate.seed);assert.equal(immediate.saved,immediate.seed);assert.equal(immediate.mode,'tree');assert.ok(immediate.clean);assert.equal(immediate.sourceCount,25);record('Tree-only control change immediately autosaves clean JSON',immediate);
  // Wait for the intentional 180 ms tree-to-environment debounce, then its worker.
  await page.waitForTimeout(250);await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading);

  const expand=async locator=>{if(!(await locator.evaluate(e=>e.classList.contains('expanded'))))await locator.locator(':scope > .section-header, :scope > .subsection-header').click();};
  const branches=page.locator('#tab-parameters .panel-section').filter({has:page.locator('.section-title').filter({hasText:/^Branches$/})});await expand(branches);
  const sub=label=>branches.locator('.panel-subsection').filter({has:page.locator('.subsection-title').filter({hasText:new RegExp(`^${label}$`)})});
  const control=(section,label)=>section.locator('.control-row').filter({has:page.locator('.control-label').filter({hasText:new RegExp(`^${label}$`)})}).locator('input[type="number"]');
  const sourcesBefore=await page.evaluate(()=>{const e=window.__EZ_ENVIRONMENT__.environment;return{canopy:e.options.canopySources.find(s=>s.source==='scene-tree'&&s.x===0&&s.z===0).radius,exclusion:e.options.treeExclusions.find(s=>s.source==='scene-tree'&&s.x===0&&s.z===0).radius};});
  await expand(sub('Radius'));await control(sub('Radius'),'Level 0').fill('3.8');await control(sub('Radius'),'Level 0').press('Tab');
  await expand(sub('Length'));await control(sub('Length'),'Level 1').fill('45');await control(sub('Length'),'Level 1').press('Tab');
  const sources=await page.evaluate(()=>{const e=window.__EZ_ENVIRONMENT__.environment,saved=JSON.parse(localStorage.getItem('ez-environment-project-v2'));return{canopy:e.options.canopySources.find(s=>s.source==='scene-tree'&&s.x===0&&s.z===0).radius,exclusion:e.options.treeExclusions.find(s=>s.source==='scene-tree'&&s.x===0&&s.z===0).radius,canopies:e.options.canopySources.filter(s=>s.source==='scene-tree').length,trunks:e.options.treeExclusions.filter(s=>s.source==='scene-tree').length,savedRadius:saved.tree.branch.radius[0]};});
  assert.ok(Math.abs(sources.exclusion-3.8*1.3)<1e-9);assert.notEqual(sources.canopy,sourcesBefore.canopy);assert.equal(sources.canopies,25);assert.equal(sources.trunks,25);assert.equal(sources.savedRadius,3.8);record('Hero resizing refreshes and autosaves canopy and trunk exclusions',sources);
  await page.waitForTimeout(250);await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading);

  await page.evaluate(()=>{window.__treeProof.before=window.__treeProof.snapshot();});
  await expand(sub('Taper'));await control(sub('Taper'),'Level 0').fill('1');await control(sub('Taper'),'Level 0').press('Tab');
  await page.waitForFunction(()=>document.getElementById('studio-status').textContent.startsWith('Tree change not applied:'));
  const unsafe=await page.evaluate(()=>({same:window.__treeProof.same(window.__treeProof.before),error:document.getElementById('studio-status').textContent}));
  assert.ok(Object.values(unsafe.same).every(Boolean));assert.match(unsafe.error,/below 1/);record('Unsafe tree slider endpoint rolls back without touching live geometry',unsafe);

  await page.locator('#ui-container [data-tab="export"]').click();
  const download=page.waitForEvent('download');await page.locator('#ui-container').getByRole('button',{name:'Save Preset',exact:true}).click();
  const file=await download,target=path.join(output,'tree-editable-preset.json');await file.saveAs(target);const bytes=await readFile(target),preset=JSON.parse(bytes.toString());
  assert.equal(preset.bark.maps,undefined);assert.equal(preset.leaves.map,undefined);assert.equal(preset.branch.radius[0],3.8);
  await page.locator('#ui-container [data-tab="parameters"]').click();await page.locator('#tab-parameters select').first().selectOption('Pine Medium');
  const presetAutosave=await page.evaluate(()=>{const t=window.__EZ_ENVIRONMENT__.tree,saved=JSON.parse(localStorage.getItem('ez-environment-project-v2'));return{live:t.options.type,saved:saved.tree.type,clean:!Object.hasOwn(saved.tree.bark,'maps')&&!Object.hasOwn(saved.tree.leaves,'map')};});
  assert.equal(presetAutosave.live,'evergreen');assert.equal(presetAutosave.saved,'evergreen');assert.ok(presetAutosave.clean);record('Original preset selector immediately autosaves a clean tree definition',presetAutosave);
  await page.locator('#ui-container [data-tab="export"]').click();const chooser=page.waitForEvent('filechooser');await page.locator('#ui-container').getByRole('button',{name:'Load Preset',exact:true}).click();await(await chooser).setFiles(target);
  await page.waitForFunction(seed=>{const t=window.__EZ_ENVIRONMENT__.tree;return t.options.seed===seed&&t.options.branch.radius[0]===3.8&&t.leavesMesh.material.map?.image?.width>0&&t.branchesMesh.material.map?.image?.width>0;},preset.seed);
  const imported=await page.evaluate(()=>{const t=window.__EZ_ENVIRONMENT__.tree;return{copy:typeof t.options.copy==='function',type:t.options.type,seed:t.options.seed,bark:!!t.branchesMesh.material.map?.image,leaves:!!t.leavesMesh.material.map?.image};});
  assert.ok(imported.copy&&imported.bark&&imported.leaves);assert.equal(imported.type,preset.type);record('Original tree JSON export and import preserve editable textured geometry',{...imported,bytes:bytes.length});
  await page.locator('#ui-container [data-tab="parameters"]').click();
  const seedControl=page.locator('#tab-parameters .control-row').filter({has:page.locator('.control-label').filter({hasText:/^Seed$/})}).locator('input[type="number"]');await seedControl.fill(String((preset.seed+1)%65536));await seedControl.press('Tab');
  const afterEdit=await page.evaluate(()=>{const t=window.__EZ_ENVIRONMENT__.tree;let finite=true;t.traverse(o=>{if(o.geometry)for(const a of Object.values(o.geometry.attributes))finite&&=a.array.every(Number.isFinite);});return{copy:typeof t.options.copy==='function',finite,seed:t.options.seed,textured:!!t.branchesMesh.material.map&&!!t.leavesMesh.material.map};});
  assert.equal(afterEdit.seed,(preset.seed+1)%65536);assert.ok(afterEdit.copy&&afterEdit.finite&&afterEdit.textured);record('Imported original tree remains editable and finite',afterEdit);
  await page.screenshot({path:path.join(output,'tree-workflow-verified.png')});
  await page.waitForTimeout(250);await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.environment.loading);

  for(const kind of ['plant','rock']){
    await page.locator(`[data-mode="${kind}"]`).click();await page.waitForFunction(kind=>{const s=window.__EZ_ENVIRONMENT__.studio;return s.mode===kind&&!s.pending&&!!s.asset;},kind);
    const proof=await page.evaluate(()=>{const s=window.__EZ_ENVIRONMENT__.studio;return{mode:s.mode,hash:s.asset.definitionHash,lods:s.asset.lods.length,copy:typeof window.__EZ_ENVIRONMENT__.tree.options.copy==='function'};});
    assert.equal(proof.mode,kind);assert.equal(proof.lods,3);assert.ok(proof.hash&&proof.copy);record(`${kind} authoring still boots after tree save and restore`,proof);
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;console.error(error);if(page)await page.screenshot({path:path.join(output,'tree-workflow-failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();server?.kill();report.finishedAt=new Date().toISOString();await mkdir(output,{recursive:true});await writeFile(path.join(output,'tree-workflow-report.json'),JSON.stringify(report,null,2));}
