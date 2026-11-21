import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('artifacts/surface-detail'); await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(120000);
const errors = [], failedTextures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (['warning', 'error'].includes(message.type())) errors.push(message.text());
});
page.on('requestfailed', request => {
  if (request.url().includes('/textures/')) failedTextures.push(request.url());
});
page.on('response', response => {
  if (response.status() >= 400 && response.url().includes('/textures/')) failedTextures.push(response.url());
});
try {
  await page.goto(process.env.EZ_TEST_URL || 'http://127.0.0.1:5194');await page.waitForFunction(()=>window.__EZ_ENVIRONMENT__?.ready);
  const bundledTextureCount = await page.evaluate(async () => {
    const { loadPbrFamily } = await import('/materials/pbr.js');
    const { LEAF_TEXTURES } = await import('/generators/leaf-textures.js');
    const { GRASS_TYPES } = await import('/generators/grass-atlases.js');
    const { applyTreeTextures, BarkType, LeafType } = await import('/textures.js');
    const { textureReadiness } = await import('/materials/readiness.js');
    const families = await Promise.all([
      ...LEAF_TEXTURES.map(variant => loadPbrFamily('foliage', { variant })),
      ...[...Object.keys(GRASS_TYPES), 'meadow-extended'].map(variant => loadPbrFamily('grassCards', { variant })),
      ...['stem', 'petal', 'pollen', 'wood', 'endgrain', 'stone', 'sandstone'].map(id => loadPbrFamily(id)),
      loadPbrFamily('foliage', { variant: 'fern-frond' }),
    ]);
    const leaves = Object.values(LeafType);
    for (const [index, type] of Object.values(BarkType).entries()) {
      const options = { bark: { type, maps: {} }, leaves: { type: leaves[index % leaves.length] }, trellis: {} };
      applyTreeTextures({ options });
      const { map, normalMap, roughnessMap } = options.leaves;
      families.push(options.bark.maps, { map, normalMap, roughnessMap });
    }
    const textures = [...new Set(families.flatMap(Object.values))];
    await Promise.all(textures.map(textureReadiness));
    for (const texture of textures) {
      const image = texture.image;
      if (!(image instanceof HTMLImageElement && image.naturalWidth > 0 && new URL(image.src).pathname.startsWith('/textures/'))) {
        throw new Error('Missing or non-file-backed texture ' + texture.name);
      }
    }
    return textures.length;
  });
  const coverage=await page.evaluate(async()=>{
    const {ASSET_PRESETS}=await import('/generators/catalog.js');
    const plants=await import('/generators/plants.js'),rocks=await import('/generators/rocks.js');
    const {prepareAssetMaterials,assertPbrReady}=await import('/materials/pbr.js');
    const {getLeafMap}=await import('/textures.js');
    const treeMap=getLeafMap('ash'),treeImage=treeMap.image;
    const result=[];
    for(const preset of ASSET_PRESETS){
      const asset=rocks.ROCK_ARCHETYPES.includes(preset.definition.archetype)?rocks.generateRock(preset.definition):plants.generatePlant(preset.definition);
      try { await prepareAssetMaterials(asset);asset.lods.forEach(lod=>assertPbrReady(lod,{requireAll:true}));result.push(preset.id); }
      finally {asset.dispose();}
    }
    if(getLeafMap('ash')!==treeMap||treeMap.image!==treeImage)throw new Error('Tree map was modified.');
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
      app.environment.visible=true;app.environment.content.visible=false;app.environment.grove.root.visible=false;app.tree.visible=false;
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
  assert.deepEqual(failedTextures, []);
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,bundledTextureCount,coverage,surfaces,errors,failedTextures},null,2));
  console.log(JSON.stringify({passed:true,bundledTextureCount,presets:coverage.length,surfaces:surfaces.length}));
}finally{await browser.close();}
