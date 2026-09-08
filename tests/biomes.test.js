import test from 'node:test';
import assert from 'node:assert/strict';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { BIOMES, applyBiome } from '../src/app/environment/biomes.js';
import { biomeTreeRecords, withBiomeSources } from '../src/app/environment/biome-placement.js';
import { DEFAULT_OPTIONS, LAYERS, validateOptions } from '../src/app/environment/options.js';
import { contains, generatePlacement, terrainHeight, terrainNormal } from '../src/app/environment/placement.js';
import { createTerrainGeometry } from '../src/app/environment/terrain.js';

test('complete presets clear prior biome overrides and preserve authored world data', () => {
  const input = validateOptions({seed:17,radius:32,chunkSize:16,composition:'biome',quality:'high',appearance:'photorealistic',
    brushes:[{type:'circle',x:4,z:8,radius:3,strength:-1,layer:'grass'}],
    exclusions:[{type:'rectangle',x:12,z:4,width:3,depth:4}],
    customSpecies:[{id:'authored-shrub',definition:{version:1,archetype:'shrub'}}],
    layers:{grass:{densityMap:{width:1,height:1,data:[.6],origin:[-32,-32],size:[64,64]}}}});
  const before = structuredClone(input), baseline = structuredClone(BIOMES);
  const forest = applyBiome(input,'forest');
  const edited = structuredClone(forest);
  edited.layers.flowers.enabled=false;edited.layers.plants.rules.maxSlope=2;
  edited.wind.direction=[-1,0];edited.lighting.exposure=2;
  const desert = applyBiome(edited,'desert'), restored = applyBiome(desert,'forest');
  assert.deepEqual(restored,forest,'switching away and back must reset all preset-controlled settings');
  for(const key of ['seed','radius','chunkSize','quality','appearance','brushes','exclusions','customSpecies']) assert.deepEqual(desert[key],input[key],key);
  assert.deepEqual(desert.layers.grass.densityMap,input.layers.grass.densityMap);
  assert.equal(desert.layers.flowers.enabled,false);assert.equal(forest.layers.flowers.enabled,true);
  assert.equal(desert.includeAuthoredTree,false);assert.equal(desert.modified,false);
  assert.deepEqual(input,before);assert.deepEqual(BIOMES,baseline);
  assert.throws(()=>applyBiome(input,'unknown'),/Unknown biome/);
});

test('legacy options retain their original placement until a complete biome is explicitly applied', () => {
  const legacy = validateOptions({biome:'woodland',terrain:{amplitude:0}});
  assert.equal(legacy.composition,'legacy');assert.equal(legacy.biome,'woodland');
  assert.equal(legacy.includeAuthoredTree,true);assert.deepEqual(biomeTreeRecords(legacy),[]);
  assert.equal(generatePlacement(legacy).hash,'530088e3');
  const forest=applyBiome(legacy,'forest');
  assert.equal(forest.biome,'forest');assert.equal(forest.composition,'biome');
  assert.equal(forest.exclusions.length,0,'explicit upgrade removes the former automatic central clearing');
  assert.deepEqual(legacy.exclusions,DEFAULT_OPTIONS.exclusions);
});

test('biome groves are seeded, terrain-aligned, spaced, and absent from Desert', () => {
  const forest=applyBiome(validateOptions({radius:48,exclusions:[]}), 'forest');
  const records=biomeTreeRecords(forest);
  assert.ok(records.length>=30,'Forest must contain a grove within the editable terrain');
  assert.deepEqual(biomeTreeRecords(structuredClone(forest)),records);
  assert.notDeepEqual(biomeTreeRecords({...forest,seed:forest.seed+1}),records);
  assert.deepEqual(biomeTreeRecords(applyBiome(forest,'desert')),[]);
  for(let i=0;i<records.length;i++){
    const r=records[i];assert.ok(Math.hypot(r.x,r.z)<=forest.radius);assert.equal(r.y,terrainHeight(r.x,r.z,forest));
    assert.ok(terrainNormal(r.x,r.z,forest)[1]>=.8);
    for(const other of records.slice(i+1))assert.ok(Math.hypot(r.x-other.x,r.z-other.z)>=BIOMES.forest.trees.spacing);
  }
  const excluded={...forest,exclusions:[{type:'circle',x:0,z:0,radius:18}]};
  assert.ok(biomeTreeRecords(excluded).every(r=>!contains(excluded.exclusions[0],r.x,r.z,1.8)));
  const meadow=applyBiome(forest,'meadow');
  assert.ok(biomeTreeRecords(meadow).every(r=>Math.hypot(r.x,r.z)>=meadow.radius*.65));
});

test('tree-derived masks replace their previous generation without losing authored sources', () => {
  const options=applyBiome(validateOptions({radius:32}), 'forest');
  options.treeExclusions=[{type:'circle',x:0,z:0,radius:2,source:'authored-tree'}];
  options.canopySources=[{x:0,z:0,radius:12,strength:.5,source:'authored-tree'}];
  const before=structuredClone(options),records=biomeTreeRecords(options), derived=withBiomeSources(options,records);
  assert.deepEqual(withBiomeSources(derived,records),derived,'rebuilding does not append duplicate masks');
  assert.deepEqual(options,before);assert.equal(derived.treeExclusions.length,records.length+1);
  assert.equal(derived.canopySources.length,records.length+1);
  const cleared=withBiomeSources(derived,[]);
  assert.deepEqual(cleared.treeExclusions,options.treeExclusions);assert.deepEqual(cleared.canopySources,options.canopySources);
  const placement=generatePlacement(derived);
  for(const chunk of placement.chunks.values())for(const layer of LAYERS)for(const r of chunk.layers[layer].records){
    assert.ok(derived.treeExclusions.every(s=>!contains(s,r.position[0],r.position[2])));
  }
});

test('all biome placements and tree transforms are independent of appearance and quality', () => {
  for(const id of Object.keys(BIOMES)){
    const options=applyBiome(validateOptions({radius:32,chunkSize:16}),id), trees=biomeTreeRecords(options);
    const baseline=generatePlacement(withBiomeSources(options,trees));
    for(const appearance of ['naturalistic','photorealistic'])for(const quality of ['low','medium','high']){
      const variant={...options,appearance,quality};
      assert.deepEqual(biomeTreeRecords(variant),trees,`${id}/${appearance}/${quality} trees`);
      const placement=generatePlacement(withBiomeSources(variant,trees));
      assert.equal(placement.hash,baseline.hash,`${id}/${appearance}/${quality} placement hash`);
      assert.deepEqual(placement.count,baseline.count);
    }
  }
});

test('rendered rolling hills, dunes, and ridges match analytic placement heights', () => {
  const surfaces=[];
  for(const id of ['forest','desert','rocky']){
    const options=applyBiome(validateOptions({radius:32}),id),geometry=createTerrainGeometry(options);
    const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material);mesh.updateMatrixWorld(true);
    const position=geometry.attributes.position,detailUV=geometry.attributes.uv1;
    assert.equal(detailUV.count,position.count);assert.ok(detailUV.array.every(Number.isFinite));
    assert.equal(geometry.userData.terrainTiles.length,4);
    assert.deepEqual(geometry.groups.map(group=>group.materialIndex),[0,1,2,3,4,4,4,4]);
    for(let i=0;i<position.count;i+=97)assert.ok(Math.abs(position.getY(i)-(terrainHeight(position.getX(i),position.getZ(i),options)-.015))<1e-5);
    const ray=new Raycaster(),heights=[];
    for(const [x,z]of [[-21.3,7.4],[1.37,2.41],[11.11,-9.81],[18.41,17.81],[-4.1,-24.8]]){
      ray.set(new Vector3(x,100,z),new Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit);
      const y=terrainHeight(x,z,options);heights.push(y);
      assert.ok(Math.abs(hit.point.y-(y-.015))<.08,`${id} render/placement mismatch at ${x}, ${z}`);
      assert.ok(Math.abs(Math.hypot(...terrainNormal(x,z,options))-1)<1e-12);
    }
    surfaces.push(heights);geometry.dispose();material.dispose();
  }
  assert.notDeepEqual(surfaces[0],surfaces[1]);assert.notDeepEqual(surfaces[1],surfaces[2]);
});
