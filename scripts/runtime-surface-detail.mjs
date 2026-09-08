import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('artifacts/surface-detail'); await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(120000); const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5194');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready);
  const coverage=await page.evaluate(async()=>{
    const {ASSET_PRESETS}=await import('/generators/catalog.js');
    const plants=await import('/generators/plants.js'),rocks=await import('/generators/rocks.js');
    const {prepareAssetMaterials,assertPbrReady,getBotanicalMaps}=await import('/materials/pbr.js');
    const treeMap=getBotanicalMaps('foliage').map,treeImage=treeMap.image;
    const result=[];
    for(const preset of ASSET_PRESETS){
      const asset=rocks.ROCK_ARCHETYPES.includes(preset.definition.archetype)?rocks.generateRock(preset.definition):plants.generatePlant(preset.definition);
      try { await prepareAssetMaterials(asset);asset.lods.forEach(lod=>assertPbrReady(lod,{requireAll:true}));result.push(preset.id); }
      finally {asset.dispose();}
    }
    if(getBotanicalMaps('foliage').map!==treeMap||treeMap.image!==treeImage)throw new Error('Tree map was modified.');
    return result;
  });
  const surfaces=[];
  for(const type of ['shrub','bush','sapling','flower','grass','cactus','succulent','rock','boulder','pebble','slab','outcrop']){
    const detail=await page.evaluate(async type=>{
      const app=window.__EZ_ENVIRONMENT__,studio=app.studio;
      const {ROCK_ARCHETYPES,createRockDefinition}=await import('/generators/rocks.js');
      const {createPlantDefinition}=await import('/generators/plants.js');
      const mode=ROCK_ARCHETYPES.includes(type)?'rock':'plant';await studio.setMode(mode);
      studio.definitions[mode]=mode==='rock'?createRockDefinition(type):createPlantDefinition(type);
      await studio.generate(true);studio.renderPanel();studio.fit();
      // Isolate the authored surface for QA, retaining the editor's lights and
      // renderer. This changes only this disposable browser session.
      app.environment.visible=true;app.environment.content.visible=false;app.environment.grove.root.visible=false;app.tree.visible=false;if(app.forest)app.forest.visible=false;
      const sample=[];
      studio.asset.lods[0].traverse(mesh=>{if(!mesh.isMesh||!mesh.geometry.attributes.position.count)return;
        const m=mesh.material,image=m.map.image,canvas=document.createElement('canvas');canvas.width=canvas.height=128;
        canvas.getContext('2d').drawImage(image,0,0,128,128);const data=canvas.getContext('2d').getImageData(0,0,128,128).data;
        let sum=0,squares=0;for(let i=0;i<data.length;i+=4){sum+=data[i];squares+=data[i]*data[i];}
        const count=data.length/4;sample.push({name:m.name,width:image.width,contrast:Math.sqrt(squares/count-(sum/count)**2)});
      });
      app.render();return sample;
    },type);
    assert.ok(detail.every(m=>m.width>=512&&m.contrast>5),`${type}: insufficient visible albedo variation ${JSON.stringify(detail)}`);
    await page.screenshot({path:path.join(output,`${type}.png`)});surfaces.push({type,materials:detail});
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,coverage,surfaces,errors},null,2));
  console.log(JSON.stringify({passed:true,presets:coverage.length,surfaces:surfaces.length}));
}finally{await browser.close();}
