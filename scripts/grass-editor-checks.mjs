import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkGrassEditor(page,output){
  const control=label=>page.locator(`#studio-panel [aria-label="${label}"]`);
  const idle=()=>page.waitForFunction(()=>{
    const s=window.__EZ_ENVIRONMENT__.studio;
    return !s.pending&&s.asset?.definition.grassCardEdits&&JSON.stringify(s.asset.definition)===JSON.stringify(s.definitions.plant);
  }).catch(async error=>{
    console.log('Grass editor diagnostics',await page.evaluate(()=>{
      const s=window.__EZ_ENVIRONMENT__.studio;
      return{status:document.getElementById('studio-status').textContent,pending:!!s.pending,definition:s.definitions.plant,generated:s.asset?.definition,moveX:document.querySelector('[aria-label="Move X · m"]')?.value};
    }));throw error;
  });
  await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.setMode('plant'));
  await control('Form').selectOption('grass');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definition.archetype==='grass');
  await control('Clump layout').selectOption('naturalOffset');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definition.cardLayout==='naturalOffset');
  // Selecting an already-selected layout can leave a debounced regeneration
  // queued while the old asset already matches. Finish that job before typing.
  await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.ensureAsset());
  await page.getByRole('button',{name:'Edit grass planes',exact:true}).click();
  const before=await page.evaluate(()=>Array.from(window.__EZ_ENVIRONMENT__.studio.asset.lods[0].children[0].geometry.attributes.position.array));
  await control('Move X · m').fill('0.18');await control('Move X · m').press('Tab');await idle();
  await control('Rotate Y · °').fill('35');await control('Rotate Y · °').press('Tab');await idle();
  await control('Plane width ×').fill('1.25');await control('Plane width ×').press('Tab');await idle();
  await control('Plane PNG').selectOption('dry');await idle();
  await control('Flip PNG horizontally').check();await idle();
  const edited=await page.evaluate(()=>{
    const s=window.__EZ_ENVIRONMENT__.studio;
    return {vertices:Array.from(s.asset.lods[0].children[0].geometry.attributes.position.array),edit:s.definitions.plant.grassCardEdits.naturalOffset[0],wind:s.previewWind.strength.value};
  });
  assert.notDeepEqual(edited.vertices.slice(0,12),before.slice(0,12));assert.deepEqual(edited.vertices.slice(12),before.slice(12));
  assert.equal(edited.edit.rotation[1],35);assert.equal(edited.edit.width,1.25);assert.equal(edited.edit.texture,'dry');assert.equal(edited.edit.flipX,true);assert.equal(edited.wind,0);
  // Exercise a real viewport drag against the projected X-axis picker.
  const handle=await page.evaluate(()=>{
    const a=window.__EZ_ENVIRONMENT__,g=a.studio.grassEditor.gizmo;
    a.render();g.updateMatrixWorld(true);
    const picker=g.children[0].picker.translate.children.find(object=>object.name==='X');
    picker.geometry.computeBoundingBox();const point=picker.geometry.boundingBox.getCenter(g.position.clone()).applyMatrix4(picker.matrixWorld).project(a.camera);
    const rect=a.renderer.domElement.getBoundingClientRect();return{x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
  });
  await page.mouse.move(handle.x,handle.y);await page.mouse.down();
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.grassEditor.dragging),true,'Viewport move handle should start a drag');
  await page.mouse.move(handle.x+55,handle.y-15,{steps:8});await page.mouse.up();await idle();
  const dragged=await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.definitions.plant.grassCardEdits.naturalOffset[0]);
  assert.notDeepEqual(dragged.position,edited.edit.position,'Dragging the gizmo must change the saved plane transform');
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.controls.enabled),true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await idle();
  assert.deepEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.definitions.plant.grassCardEdits.naturalOffset[0]),edited.edit);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await idle();
  await page.getByRole('button',{name:'Save clump layout',exact:true}).click();
  await page.waitForFunction(()=>!!JSON.parse(localStorage.getItem('ez-grass-plane-layouts-v1')||'{}').naturalOffset);
  const natural=await page.evaluate(()=>JSON.parse(localStorage.getItem('ez-grass-plane-layouts-v1')).naturalOffset);
  await page.getByRole('button',{name:'Rotate',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.grassEditor.gizmo.mode),'rotate');
  await page.locator('.studio-section').filter({has:page.getByText('Grass plane editor',{exact:true})}).locator('summary').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'grass-plane-editor.png')});
  await control('Clump layout').selectOption('denseTuft');await idle();
  await control('Selected plane').selectOption('1');
  await control('Move Z · m').fill('-0.12');await control('Move Z · m').press('Tab');await idle();
  await page.getByRole('button',{name:'Save & finish editing',exact:true}).click();
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.grassEditor.active);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ez-grass-plane-layouts-v1')));
  assert.deepEqual(saved.naturalOffset,natural);assert.notEqual(saved.denseTuft[1].position[2],0);
  await control('Preset').selectOption('short-meadow-grass');await idle();
  await control('Clump layout').selectOption('naturalOffset');await idle();
  assert.deepEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.definitions.plant.grassCardEdits.naturalOffset),natural);
  await page.evaluate(async()=>{const s=window.__EZ_ENVIRONMENT__.studio;await s.loadProject(JSON.parse(JSON.stringify(s.project())));});
  assert.deepEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.definitions.plant.grassCardEdits.naturalOffset),natural);
  assert.deepEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.grassEditor.saved),saved);
  console.log('PASS grass plane editor: numeric editing, PNG selection, real gizmo drag, undo/redo, independent layouts and project round trip');
  return saved;
}

export async function checkGrassEditorRestart(page,expected){
  await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready,null,{timeout:180000});
  assert.deepEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.grassEditor.saved),expected);
  await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.setMode('plant'));
  await page.locator('#studio-panel select[aria-label="Form"]').selectOption('grass');
  await page.waitForFunction(()=>!window.__EZ_ENVIRONMENT__.studio.pending&&window.__EZ_ENVIRONMENT__.studio.asset.definition.archetype==='grass');
  assert.deepEqual(await page.evaluate(()=>window.__EZ_ENVIRONMENT__.studio.definitions.plant.grassCardEdits),expected);
  console.log('PASS saved grass arrangements load automatically after restart');
}
