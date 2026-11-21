import test from 'node:test';
import assert from 'node:assert/strict';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { MEADOW, applyMeadowPreset } from '../src/app/environment/biomes.js';
import { biomeTreeRecords, withBiomeSources } from '../src/app/environment/biome-placement.js';
import { DEFAULT_OPTIONS, LAYERS, validateOptions } from '../src/app/environment/options.js';
import { contains, generatePlacement, terrainHeight, terrainNormal } from '../src/app/environment/placement.js';
import { createTerrainGeometry } from '../src/app/environment/terrain.js';

test('Meadow reset restores preset settings and preserves authored world data', () => {
  const input = validateOptions({seed:17,radius:32,chunkSize:16,composition:'biome',quality:'high',appearance:'photorealistic',
    brushes:[{type:'circle',x:4,z:8,radius:3,strength:-1,layer:'grass'}],
    exclusions:[{type:'rectangle',x:12,z:4,width:3,depth:4}],
    customSpecies:[{id:'authored-shrub',definition:{version:1,archetype:'shrub'}}],
    layers:{grass:{densityMap:{width:1,height:1,data:[.6],origin:[-32,-32],size:[64,64]}}}});
  const before = structuredClone(input), baseline = structuredClone(MEADOW);
  const meadow = applyMeadowPreset(input);
  const edited = structuredClone(meadow);
  edited.layers.flowers.enabled=false;edited.layers.plants.rules.maxSlope=2;
  edited.wind.direction=[-1,0];edited.lighting.exposure=2;
  const restored = applyMeadowPreset(edited);
  assert.deepEqual(restored,meadow);
  for(const key of ['seed','radius','chunkSize','quality','appearance','brushes','exclusions','customSpecies']) assert.deepEqual(restored[key],input[key],key);
  assert.deepEqual(restored.layers.grass.densityMap,input.layers.grass.densityMap);
  assert.equal(restored.layers.flowers.enabled,true);
  assert.equal(restored.includeAuthoredTree,false);assert.equal(restored.modified,false);
  assert.deepEqual(input,before);assert.deepEqual(MEADOW,baseline);
});

test('saved Forest, Desert, Rocky, and Woodland projects open as modified Meadow scenes', () => {
  for (const biome of ['forest', 'desert', 'rocky', 'woodland']) {
    const saved = { biome, composition: 'biome', seed: 19, terrain: { form: 'ridges', amplitude: 9 },
      lighting: { sky: '#123456' }, layers: { grass: { density: .1, species: 'grass_clump' } } };
    const migrated = validateOptions(saved);
    assert.equal(migrated.biome, 'meadow');
    assert.equal(migrated.modified, true);
    assert.equal(migrated.seed, 19);
    assert.deepEqual(migrated.terrain, { form: 'ridges', amplitude: 9, scale: 48 });
    assert.equal(migrated.lighting.sky, '#123456');
    assert.equal(migrated.layers.grass.species, 'grass_clump');
    assert.equal(migrated.layers.grass.density, .1);
    assert.deepEqual(validateOptions(migrated), migrated);
    assert.equal(saved.biome, biome);
  }
  assert.throws(() => validateOptions({ biome: 'unknown' }), /Unknown biome/);
  assert.throws(() => validateOptions({ biome: 'desert', modified: 'yes' }), /Invalid biome flags/);
});

test('legacy projects retain their original layout until Meadow is explicitly reset', () => {
  const legacy = validateOptions({biome:'woodland',terrain:{amplitude:0}});
  assert.equal(legacy.composition,'legacy');assert.equal(legacy.biome,'meadow');
  assert.equal(legacy.includeAuthoredTree,true);assert.deepEqual(biomeTreeRecords(legacy),[]);
  assert.equal(generatePlacement(legacy).hash,'530088e3');
  const meadow=applyMeadowPreset(legacy);
  assert.equal(meadow.biome,'meadow');assert.equal(meadow.composition,'biome');
  assert.equal(meadow.exclusions.length,0,'explicit upgrade removes the former automatic central clearing');
  assert.deepEqual(legacy.exclusions,DEFAULT_OPTIONS.exclusions);
});

test('Meadow groves are seeded, terrain-aligned, and spaced near the perimeter', () => {
  const meadow=applyMeadowPreset(validateOptions({radius:96,exclusions:[]}));
  const records=biomeTreeRecords(meadow);
  assert.ok(records.length>1);
  assert.deepEqual(biomeTreeRecords(structuredClone(meadow)),records);
  assert.notDeepEqual(biomeTreeRecords({...meadow,seed:meadow.seed+1}),records);
  for(let i=0;i<records.length;i++){
    const r=records[i], distance=Math.hypot(r.x,r.z);
    assert.ok(distance<=meadow.radius&&distance>=meadow.radius*.65);
    assert.equal(r.y,terrainHeight(r.x,r.z,meadow));
    assert.ok(terrainNormal(r.x,r.z,meadow)[1]>=.8);
    for(const other of records.slice(i+1))assert.ok(Math.hypot(r.x-other.x,r.z-other.z)>=MEADOW.trees.spacing);
  }
  const excluded={...meadow,exclusions:[{type:'circle',x:records[0].x,z:records[0].z,radius:6}]};
  assert.ok(biomeTreeRecords(excluded).every(r=>!contains(excluded.exclusions[0],r.x,r.z,1.8)));
});

test('tree-derived masks replace their previous generation without losing authored sources', () => {
  const options=applyMeadowPreset(validateOptions({radius:32}));
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

test('Meadow placements and tree transforms are independent of appearance and quality', () => {
    const options=applyMeadowPreset(validateOptions({radius:32,chunkSize:16})), trees=biomeTreeRecords(options);
    const baseline=generatePlacement(withBiomeSources(options,trees));
    for(const appearance of ['naturalistic','photorealistic'])for(const quality of ['low','medium','high']){
      const variant={...options,appearance,quality};
      assert.deepEqual(biomeTreeRecords(variant),trees,`${appearance}/${quality} trees`);
      const placement=generatePlacement(withBiomeSources(variant,trees));
      assert.equal(placement.hash,baseline.hash,`${appearance}/${quality} placement hash`);
      assert.deepEqual(placement.count,baseline.count);
    }
});

test('rendered rolling hills, dunes, and ridges match analytic placement heights', () => {
  const surfaces=[];
  for(const form of ['rolling','dunes','ridges']){
    const options=applyMeadowPreset(validateOptions({radius:32}));
    options.terrain.form=form;
    const geometry=createTerrainGeometry(options);
    const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material);mesh.updateMatrixWorld(true);
    const position=geometry.attributes.position,detailUV=geometry.attributes.uv;
    assert.equal(detailUV.count,position.count);assert.ok(detailUV.array.every(Number.isFinite));
    assert.equal(geometry.userData.terrainTiles.length,4);
    for(let i=0;i<position.count;i+=97)assert.ok(Math.abs(position.getY(i)-(terrainHeight(position.getX(i),position.getZ(i),options)-.015))<1e-5);
    const ray=new Raycaster(),heights=[];
    for(const [x,z]of [[-21.3,7.4],[1.37,2.41],[11.11,-9.81],[18.41,17.81],[-4.1,-24.8]]){
      ray.set(new Vector3(x,100,z),new Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit);
      const y=terrainHeight(x,z,options);heights.push(y);
      assert.ok(Math.abs(hit.point.y-(y-.015))<.08,`${form} render/placement mismatch at ${x}, ${z}`);
      assert.ok(Math.abs(Math.hypot(...terrainNormal(x,z,options))-1)<1e-12);
    }
    surfaces.push(heights);geometry.dispose();material.dispose();
  }
  assert.notDeepEqual(surfaces[0],surfaces[1]);assert.notDeepEqual(surfaces[1],surfaces[2]);
});
