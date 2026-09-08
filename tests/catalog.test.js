import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ASSET_PRESETS, assetLayer, layerSpecies } from '../src/app/generators/catalog.js';
import { PLANT_PRESETS, createPlantDefinition, generatePlant } from '../src/app/generators/plants.js';
import { ROCK_PRESETS, createRockDefinition, generateRock } from '../src/app/generators/rocks.js';
import { makeSpecies, createRegistry } from '../src/app/environment/species.js';
import { BIOMES, applyBiome } from '../src/app/environment/biomes.js';
import { validateOptions } from '../src/app/environment/options.js';

test('catalog IDs, layers and biome mixtures resolve to regenerable built-ins',async()=>{
  assert.equal(PLANT_PRESETS.length,27);assert.equal(ROCK_PRESETS.length,22);
  assert.equal(new Set(ASSET_PRESETS.map(p=>p.id)).size,49);
  const registry=await createRegistry([],null,false);
  try{
    for(const p of ASSET_PRESETS){assert.equal(assetLayer(p.definition),p.layer);assert.ok(registry.has(p.id));assert.ok(layerSpecies(p.layer).some(s=>s.id===p.id));assert.deepEqual(registry.get(p.id).definition,p.definition);}
    for(const id of Object.keys(BIOMES))for(const [layer,options]of Object.entries(applyBiome(validateOptions(),id).layers)){
      for(const s of options.speciesChoices)assert.ok(layerSpecies(layer).some(p=>p.id===s.id),`${id}/${layer}/${s.id}`);
    }
  }finally{registry.forEach(a=>a.dispose());}
});

test('authored grass and cactus definitions survive scatter reconstruction and layer routing',()=>{
  for(const form of ['grass','cactus','coniferSapling','deadwood','succulent','cushion']){
    const d=createPlantDefinition(form,{seed:567,height:1.7,width:1.3});
    const a=makeSpecies(form,d),b=makeSpecies(form,JSON.parse(JSON.stringify(d)));
    assert.deepEqual(a.definition,d);assert.equal(a.definitionHash,b.definitionHash);
    const size=new THREE.Box3().setFromObject(b.object3D).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y-1.7)<1e-5);assert.equal(assetLayer(d),form==='grass'?'grass':'plants');
    if(['deadwood','succulent','cactus'].includes(form)){assert.equal(a.object3D.userData.wind,false);a.object3D.traverse(o=>{if(o.geometry)assert.ok(o.geometry.attributes.windWeight.array.every(v=>v===0));});}
    a.dispose();b.dispose();
  }
});

test('new rock forms preserve dimensions, collider bounds, closed finite LODs and changing seeds',()=>{
  for(const archetype of ['slab','outcrop'])for(const dimensions of [{width:2,height:.1,depth:1},{width:.01,height:50,depth:2},{width:200,height:.01,depth:25}]){
    const a=generateRock(createRockDefinition(archetype,{...dimensions,seed:131,weatheringAmount:.7,strata:1}));
    const b=generateRock({...a.definition,seed:132});assert.notEqual(a.definitionHash,b.definitionHash);
    const counts=a.lods.map(g=>g.children.reduce((sum,m)=>sum+m.geometry.index.count/3,0));assert.ok(counts[0]>counts[1]&&counts[1]>counts[2]);
    for(const g of a.lods){const size=new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());for(const [axis,key]of [['x','width'],['y','height'],['z','depth']])assert.ok(Math.abs(size[axis]-dimensions[key])<1e-4,`${archetype} ${axis}`);g.traverse(o=>{if(o.geometry)for(const attr of Object.values(o.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));});}
    assert.equal(a.collider.mode,'box');a.dispose();b.dispose();
  }
});

test('new controls reject invalid input and old definitions do not acquire surface fields',()=>{
  for(const bad of [{strata:NaN},{weatheringAmount:1.1},{weatheringColor:'red'},{weatheringColor:null}])assert.throws(()=>createRockDefinition('rock',bad));
  for(const bad of [{bladeWidth:NaN},{seedHeads:'yes'}])assert.throws(()=>createPlantDefinition('grass',bad));
  assert.throws(()=>createPlantDefinition('cactus',{armCount:Infinity}));
  assert.throws(()=>createPlantDefinition('groundCover',{leafShape:'unknown'}));
  const rock=createRockDefinition('rock');assert.equal(Object.hasOwn(rock,'strata'),false);assert.equal(Object.hasOwn(rock,'weatheringAmount'),false);
  const plant=generatePlant(createPlantDefinition('shrub'));
  assert.equal(plant.definition.stemMaterial,'bark');assert.equal(plant.definition.leafMaterial,'foliage');
  const roundtrip=generatePlant(JSON.parse(JSON.stringify(plant.definition)));assert.equal(plant.definitionHash,roundtrip.definitionHash);plant.dispose();roundtrip.dispose();
});

test('built-in preset IDs cannot be shadowed by custom species',async()=>{
  await assert.rejects(()=>createRegistry([{id:'sagebrush',definition:createPlantDefinition('shrub')}],null,false),/unique safe ID/);
});

test('stone weathering works on black bases and slab variation affects the exported colors',()=>{
  const a=generateRock(createRockDefinition('rock',{color:'#000000',weatheringAmount:1,weatheringColor:'#557733'}));
  assert.equal(a.object3D.children[0].material.color.getHexString(),'ffffff');assert.ok(a.object3D.children[0].geometry.attributes.color.array.some(v=>v>0));a.dispose();
  const b=generateRock(createRockDefinition('slab',{strata:0,variation:0})),c=generateRock(createRockDefinition('slab',{strata:0,variation:1}));
  assert.notDeepEqual(b.object3D.children[0].geometry.attributes.color.array,c.object3D.children[0].geometry.attributes.color.array);b.dispose();c.dispose();
});

test('legacy custom stones remain selectable across all three stone layers',()=>{
  const custom=[{id:'custom-old-boulder',definition:createRockDefinition('boulder')}];
  for(const layer of ['rocks','boulders','pebbles'])assert.ok(layerSpecies(layer,custom).some(p=>p.id==='custom-old-boulder'));
});
