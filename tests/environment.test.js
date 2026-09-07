import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hash, random, canonical, noise } from '../src/app/environment/random.js';
import { DEFAULT_OPTIONS, LAYERS, validateOptions } from '../src/app/environment/options.js';
import { contains, terrainHeight, terrainNormal, chunkKeys, generateChunk, generatePlacement, sampleDensityMap, sampleMoisture, sampleCanopy, MAX_PLACEMENTS_PER_LAYER, MAX_PLACEMENTS_PER_CHUNK } from '../src/app/environment/placement.js';
import { EnvironmentAssetCache, disposeObject } from '../src/app/environment/assets.js';
import { createRegistry } from '../src/app/environment/species.js';
import { LodController, lodVisibilityMask } from '../src/app/environment/lod.js';
import { WindController } from '../src/app/environment/wind.js';

const onlyLayer = (layer, changes = {}, global = {}) => validateOptions({
  radius: 32, chunkSize: 16, exclusions: [], ...global,
  layers: Object.fromEntries(LAYERS.map(id => [id, { enabled: id === layer, ...(id === layer ? changes : {}) }])),
});
const recordsOf = (placement, layer) => [...placement.chunks.values()].flatMap(chunk => chunk.layers[layer].records);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

test('canonical JSON and random streams are deterministic and key-order independent', () => {
  assert.equal(canonical({ z: 1, a: { x: true, a: 2 } }), canonical({ a: { a: 2, x: true }, z: 1 }));
  assert.equal(hash({a:1,b:2}),hash({b:2,a:1}));
  const first = random('world'), second = random('world'), other = random('other');
  const a = Array.from({length: 100}, first), b = Array.from({length: 100}, second), c = Array.from({length: 100}, other);
  assert.deepEqual(a,b); assert.notDeepEqual(a,c); assert.ok(a.every(n => n >= 0 && n < 1));
  for (const x of [-10.5,0,9.25]) assert.ok(noise(x, x + 7, 12) >= 0 && noise(x, x + 7, 12) <= 1);
});

test('options merge defaults without mutating callers and reject invalid inputs', () => {
  const before = structuredClone(DEFAULT_OPTIONS), input = { layers: { grass: { density: .2 } }, terrain: { amplitude: 3 } };
  const options = validateOptions(input);
  assert.equal(options.layers.grass.density,.2); assert.equal(options.layers.grass.species,'grass'); assert.equal(options.terrain.scale,48);
  options.layers.grass.density=.4; assert.equal(input.layers.grass.density,.2); assert.deepEqual(DEFAULT_OPTIONS,before);
  for (const invalid of [
    {seed:NaN},{seed:1.5},{radius:0},{quality:'ultra'},{terrain:null},{layers:[]},
    {wind:{direction:[1]}},{layers:{grass:{enabled:1}}},{layers:{grass:{species:'../bad'}}},
    {brushes:[{type:'circle',x:0,z:0,radius:1}]},
    {brushes:[{type:'circle',x:0,z:0,radius:1,strength:1,layer:'bad'}]},
    {customSpecies:[{id:'custom',definition:{}}]},
  ]) assert.throws(() => validateOptions(invalid));
});

test('circle, rectangle, polygon and path exclusions include their boundaries and buffer', () => {
  const circle={type:'circle',x:0,z:0,radius:2}; assert.ok(contains(circle,2,0)); assert.ok(contains(circle,2.5,0,.5)); assert.ok(!contains(circle,3,0));
  const rectangle={type:'rectangle',x:0,z:0,width:4,depth:2}; assert.ok(contains(rectangle,2,1)); assert.ok(!contains(rectangle,2.1,1));
  const polygon={type:'polygon',points:[[-1,-1],[1,-1],[1,1],[-1,1]]}; assert.ok(contains(polygon,0,0)); assert.ok(contains(polygon,1,0)); assert.ok(contains(polygon,1.4,0,.5)); assert.ok(!contains(polygon,2,0,.5));
  const path={type:'path',points:[[0,0],[0,0],[4,0],[4,4]],width:2}; assert.ok(contains(path,2,1)); assert.ok(contains(path,5,2)); assert.ok(!contains(path,2,2));
});

test('terrain height and normalized normals stay finite across valid terrain', () => {
  const flat=validateOptions(); assert.equal(terrainHeight(100,-4,flat),0); assert.deepEqual(terrainNormal(100,-4,flat),[-0,1,-0]);
  const curved=validateOptions({terrain:{amplitude:15,scale:8}});
  for(let x=-64;x<=64;x+=8)for(let z=-64;z<=64;z+=8){ const n=terrainNormal(x,z,curved);assert.ok(Number.isFinite(terrainHeight(x,z,curved)));assert.ok(Math.abs(Math.hypot(...n)-1)<1e-12);assert.ok(n[1]>0); }
});

test('placement hashes repeat, seeds alter placement, and quality only affects rendering', () => {
  const options=onlyLayer('grass',{density:.15});
  const first=generatePlacement(options), second=generatePlacement(structuredClone(options));
  assert.equal(first.hash,second.hash); assert.deepEqual(recordsOf(first,'grass'),recordsOf(second,'grass'));
  assert.notEqual(first.hash,generatePlacement({...options,seed:options.seed+1}).hash);
  assert.equal(first.hash,generatePlacement({...options,quality:'high'}).hash);
  for(const chunk of first.chunks.values())for(const record of chunk.layers.grass.records){
    const [x,y,z]=record.position; assert.ok(Math.hypot(x,z)<=options.radius); assert.equal(y,0);
    assert.ok(x>=chunk.x*options.chunkSize&&x<(chunk.x+1)*options.chunkSize);
    assert.ok(z>=chunk.z*options.chunkSize&&z<(chunk.z+1)*options.chunkSize);
    assert.ok(record.scale.every(s=>s>0));assert.ok(record.normal.every(Number.isFinite));
  }
});

test('minimum spacing holds across chunk borders and generation order does not matter', () => {
  const options=onlyLayer('plants',{density:.5,minSpacing:1.8,patchiness:0});
  const placement=generatePlacement(options), records=recordsOf(placement,'plants');
  assert.ok(records.length>100);
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
    const a=records[i].position,b=records[j].position;
    assert.ok(Math.hypot(a[0]-b[0],a[2]-b[2])>=1.8-1e-10,`Spacing violated at ${a} and ${b}`);
  }
  for(const [x,z] of chunkKeys(options).reverse()) assert.deepEqual(generateChunk(options,x,z,'plants'),placement.chunks.get(`${x}:${z}`).layers.plants);
});

test('isolated regeneration preserves untouched chunks and matches a full local-mask rebuild', () => {
  const options=onlyLayer('grass',{density:.2,patchiness:0}), first=generatePlacement(options);
  const painted=validateOptions({...options,brushes:[{type:'circle',x:8,z:8,radius:5,strength:-1,layer:'grass'}]});
  const dirty=new Set(['0:0']), updated=generatePlacement(painted,first,dirty), fresh=generatePlacement(painted);
  assert.equal(updated.hash,fresh.hash);
  assert.notDeepEqual(updated.chunks.get('0:0').layers.grass.records,first.chunks.get('0:0').layers.grass.records);
  for(const [key,chunk] of updated.chunks) if(!dirty.has(key))assert.equal(chunk.layers.grass,first.chunks.get(key).layers.grass);
  assert.ok(recordsOf(updated,'grass').every(r=>!contains(painted.brushes[0],r.position[0],r.position[2])));
});

test('exclusions and rock footprints suppress vegetation; rocks receive scale-aware burial', () => {
  const options=validateOptions({radius:32,chunkSize:16,exclusions:[{type:'circle',x:0,z:0,radius:7}],layers:{grass:{density:.2},boulders:{density:.004}}});
  const placement=generatePlacement(options);
  const rocks=[...recordsOf(placement,'rocks').map(r=>({r,radius:r.scale[0]*.85})),...recordsOf(placement,'boulders').map(r=>({r,radius:r.scale[0]*2.1}))];
  for(const layer of LAYERS) for(const r of recordsOf(placement,layer))assert.ok(!contains(options.exclusions[0],r.position[0],r.position[2]));
  for(const layer of ['grass','flowers','plants'])for(const r of recordsOf(placement,layer))for(const rock of rocks)assert.ok(Math.hypot(r.position[0]-rock.r.position[0],r.position[2]-rock.r.position[2])>=rock.radius);
  for(const layer of ['rocks','boulders','pebbles'])for(const r of recordsOf(placement,layer))assert.ok(r.position[1]<terrainHeight(r.position[0],r.position[2],options));
});

test('rock paint with a neighboring-chunk halo matches complete regeneration', () => {
  const options=validateOptions({radius:64,chunkSize:16,layers:{grass:{density:.2},rocks:{density:.015,size:2},boulders:{density:.005,size:3}}});
  const original=generatePlacement(options),stroke={type:'circle',x:15.5,z:8,radius:6,strength:-1,layer:'boulders'};
  const changed=validateOptions({...options,brushes:[stroke]}),dirty=new Set();
  for(const [key,chunk]of original.chunks){const s=changed.chunkSize,r=stroke.radius+s;if(stroke.x+r>=chunk.x*s&&stroke.x-r<=(chunk.x+1)*s&&stroke.z+r>=chunk.z*s&&stroke.z-r<=(chunk.z+1)*s)dirty.add(key);}
  assert.ok(dirty.size<original.chunks.size);
  const partial=generatePlacement(changed,original,dirty),complete=generatePlacement(changed);
  assert.equal(partial.hash,complete.hash);
  for(const [key,chunk]of partial.chunks)if(!dirty.has(key))for(const layer of LAYERS)assert.equal(chunk.layers[layer],original.chunks.get(key).layers[layer]);
});

test('resource and attempt budgets cap dense requests and report impossible placement', () => {
  const options=onlyLayer('grass',{density:2,patchiness:0,minSpacing:0},{radius:256,chunkSize:96});
  const placement=generatePlacement(options);
  assert.ok(placement.count.grass<=MAX_PLACEMENTS_PER_LAYER); assert.ok(placement.count.grass>80000);
  for(const chunk of placement.chunks.values()){
    const result=chunk.layers.grass;assert.ok(result.records.length<=MAX_PLACEMENTS_PER_CHUNK);
    assert.ok(result.attempts<=(result.records.length+result.shortfall)*18+32);
  }
  const empty=generatePlacement(onlyLayer('plants',{density:2,minSpacing:20},{exclusions:[{type:'circle',x:0,z:0,radius:100}]}));
  assert.equal(empty.count.plants,0);assert.ok([...empty.chunks.values()].some(chunk=>chunk.layers.plants.shortfall>0));
});

test('placement keeps the original 48m hash and pins the measured 64m default', () => {
  assert.equal(generatePlacement({chunkSize:48}).hash,'94438e15');
  assert.equal(generatePlacement({}).hash,'530088e3');
});

test('weighted species choices are deterministic and do not perturb placement transforms', () => {
  const options=onlyLayer('plants',{density:.4,minSpacing:.1,patchiness:0});
  const baseline=recordsOf(generatePlacement(options),'plants');
  options.layers.plants.speciesChoices=[{id:'fern',weight:3},{id:'shrub',weight:1}];
  const placement=generatePlacement(options),mixed=recordsOf(placement,'plants');
  assert.equal(generatePlacement(options).hash,placement.hash);assert.equal(mixed.length,baseline.length);
  mixed.forEach((record,index)=>assert.deepEqual({...record,species:baseline[index].species},baseline[index]));
  const fern=mixed.filter(record=>record.species==='fern').length;
  assert.ok(fern>mixed.length*.68&&fern<mixed.length*.82);assert.ok(mixed.every(record=>['fern','shrub'].includes(record.species)));
});

test('grayscale density maps interpolate, bound placement, and scale requested density', () => {
  const map={width:2,height:2,data:[0,1,0,1],origin:[0,0],size:[10,10]};
  assert.equal(sampleDensityMap(map,5,5),.5);assert.equal(sampleDensityMap(map,10,0),1);assert.equal(sampleDensityMap(map,-1,5),0);assert.equal(sampleDensityMap(map,0,0),0);
  const full={width:1,height:1,data:[1],origin:[-32,-32],size:[64,64]};
  const options=onlyLayer('grass',{density:.3,patchiness:0});const before=generatePlacement(options);
  options.layers.grass.densityMap=full;assert.equal(generatePlacement(options).hash,before.hash);
  options.layers.grass.densityMap={...full,data:[.5]};const half=generatePlacement(options);assert.ok(half.count.grass>before.count.grass*.45&&half.count.grass<before.count.grass*.52);
  options.layers.grass.densityMap={...full,data:[0]};assert.equal(generatePlacement(options).count.grass,0);
  options.layers.grass.densityMap={...full,origin:[0,0],size:[32,32]};assert.ok(recordsOf(generatePlacement(options),'grass').every(record=>record.position[0]>=0&&record.position[2]>=0));
});

test('slope, elevation, moisture and canopy filters enforce their configured intervals', () => {
  const options=onlyLayer('grass',{density:.2,patchiness:0,rules:{minSlope:0,maxSlope:25,minElevation:0,maxElevation:10,minMoisture:.2,maxMoisture:.8}},{terrain:{amplitude:8,scale:20}});
  const records=recordsOf(generatePlacement(options),'grass');assert.ok(records.length>0);
  for(const record of records){const [x,y,z]=record.position,slope=Math.acos(record.normal[1])*180/Math.PI,moisture=sampleMoisture(x,z,options);assert.ok(slope<=25+1e-8);assert.ok(y>=0&&y<=10);assert.ok(moisture>=.2&&moisture<=.8);}
  const forest=onlyLayer('grass',{density:.2,patchiness:0,rules:{minCanopy:.2,maxCanopy:.8}},{canopySources:[{x:0,z:0,radius:35,strength:1}]});
  assert.equal(sampleCanopy(0,0,forest),1);assert.equal(sampleCanopy(40,0,forest),0);
  const under=recordsOf(generatePlacement(forest),'grass');assert.ok(under.length>0);
  for(const record of under){const cover=sampleCanopy(record.position[0],record.position[2],forest);assert.ok(cover>=.2&&cover<=.8);}
  const unfiltered=onlyLayer('grass',{density:.2,patchiness:0},{canopySources:[{x:0,z:0,radius:200,strength:1}]});
  const original=generatePlacement(unfiltered).count.grass;unfiltered.layers.grass.canopyReduction=1;assert.ok(generatePlacement(unfiltered).count.grass<original*.5);
});

test('generated tree exclusions stay independent of user paint and always suppress placement', () => {
  const options=onlyLayer('grass',{density:.2},{treeExclusions:[{type:'circle',x:8,z:8,radius:9}],brushes:[{type:'circle',x:8,z:8,radius:15,strength:1,layer:'grass'}]});
  const placement=generatePlacement(options);assert.ok(recordsOf(placement,'grass').every(record=>!contains(options.treeExclusions[0],record.position[0],record.position[2])));
  options.brushes=[];assert.equal(options.treeExclusions.length,1);assert.ok(recordsOf(generatePlacement(options),'grass').every(record=>!contains(options.treeExclusions[0],record.position[0],record.position[2])));
});

test('grass dimensions/tint and configurable rock burial/tilt are applied to records', () => {
  const grass=onlyLayer('grass',{density:.1});const original=recordsOf(generatePlacement(grass),'grass');
  grass.layers.grass.height=2;grass.layers.grass.width=.5;grass.layers.grass.tint=1.5;
  recordsOf(generatePlacement(grass),'grass').forEach((record,index)=>{assert.deepEqual(record.scale,[original[index].scale[0]*.5,original[index].scale[1]*2,original[index].scale[2]*.5]);assert.equal(record.tint,original[index].tint*1.5);});
  const rocks=onlyLayer('rocks',{density:.1,minSpacing:.5,patchiness:0,maxTilt:0,burialDepth:.25,burialVariation:0,height:2,rules:{maxSlope:80}},{terrain:{amplitude:10,scale:12}});
  const placed=recordsOf(generatePlacement(rocks),'rocks');assert.ok(placed.length>0);
  for(const record of placed){assert.equal(record.normal[1],1);assert.ok(Math.abs(record.normal[0])<1e-12&&Math.abs(record.normal[2])<1e-12);assert.ok(Math.abs(record.position[1]-(terrainHeight(record.position[0],record.position[2],rocks)-record.scale[1]*.25))<1e-10);}
});

test('advanced placement validation rejects unsafe weights, fields and density maps', () => {
  const invalidLayers=[{speciesChoices:[{id:'fern',weight:0}]},{speciesChoices:[{id:'fern',weight:1},{id:'fern',weight:2}]},{speciesChoices:[{id:'../bad',weight:1}]},{rules:{minSlope:50,maxSlope:20}},{rules:{minMoisture:-1}},{height:0},{width:6},{tint:3},{color:'green'},{dryness:2},{maxTilt:91},{burialDepth:-1},{canopyReduction:2},{densityMap:{width:257,height:1,data:[],origin:[0,0],size:[1,1]}},{densityMap:{width:2,height:2,data:[1],origin:[0,0],size:[1,1]}},{densityMap:{width:1,height:1,data:[2],origin:[0,0],size:[1,1]}}];
  for(const layer of invalidLayers)assert.throws(()=>validateOptions({layers:{grass:layer}}));
  assert.throws(()=>validateOptions({canopySources:[{x:0,z:0,radius:1,strength:2}]}));assert.throws(()=>validateOptions({treeExclusions:[null]}));
  assert.throws(()=>validateOptions({wind:{gustStrength:2}}));assert.throws(()=>validateOptions({wind:{spatialScale:0}}));
});

function meshScene() {
  const group=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  group.add(new THREE.Mesh(geometry,material));group.add(new THREE.Mesh(geometry,material));
  return {group,geometry,material};
}
test('asset cache deduplicates in-flight loads and supports retry after a failed request', async () => {
  let calls=0,resolve;const source=meshScene();
  const cache=new EnvironmentAssetCache({loadAsync(){calls++;return new Promise(r=>{resolve=r;});}});
  const first=cache.load('/models/test.glb'),second=cache.load('/models/test.glb');assert.equal(first,second);assert.equal(calls,1);
  resolve({scene:source.group});assert.equal(await first,source.group);assert.equal(await cache.load('/models/test.glb'),source.group);assert.equal(calls,1);
  cache.dispose();await pause();assert.equal(cache.entries.size,0);await assert.rejects(cache.load('/models/test.glb'),/disposed/);
  let tries=0;const retry=new EnvironmentAssetCache({async loadAsync(){if(++tries===1)throw new Error('Missing asset');return {scene:meshScene().group};}});
  await assert.rejects(retry.load('/retry.glb'),/Missing asset/);await retry.load('/retry.glb');assert.equal(tries,2);retry.dispose();await pause();
});

test('asset cache rejects empty models and safely disposes an in-flight completion', async () => {
  const empty=new EnvironmentAssetCache({async loadAsync(){return {scene:new THREE.Group()};}});await assert.rejects(empty.load('/empty.glb'),/No renderable meshes/);empty.dispose();
  let resolve;const source=meshScene();let geometryDisposals=0,materialDisposals=0;
  source.geometry.addEventListener('dispose',()=>geometryDisposals++);source.material.addEventListener('dispose',()=>materialDisposals++);
  const cache=new EnvironmentAssetCache({loadAsync(){return new Promise(r=>{resolve=r;});}});
  const pending=cache.load('/slow.glb');cache.dispose();cache.dispose();resolve({scene:source.group});
  await assert.rejects(pending,/canceled/);await pause();assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);
});

test('resource disposal deduplicates shared geometry, materials, and textures', () => {
  const {group,geometry,material}=meshScene();const texture=new THREE.Texture();material.map=texture;material.normalMap=texture;
  let geometries=0,materials=0,textures=0;geometry.addEventListener('dispose',()=>geometries++);material.addEventListener('dispose',()=>materials++);texture.addEventListener('dispose',()=>textures++);
  disposeObject(group,true);assert.equal(geometries,1);assert.equal(materials,1);assert.equal(textures,1);
});

test('environment registry uses compact shrubs and releases partial initialization on load failure', async () => {
  const cache={async load(){throw new Error('Simulated missing source model');}};
  const originalGeometryDispose=THREE.BufferGeometry.prototype.dispose,originalMaterialDispose=THREE.Material.prototype.dispose;
  let geometries=0,materials=0;
  THREE.BufferGeometry.prototype.dispose=function(){geometries++;return originalGeometryDispose.call(this);};
  THREE.Material.prototype.dispose=function(){materials++;return originalMaterialDispose.call(this);};
  try{
    const registry=await createRegistry([],cache,false);
    assert.ok(registry.get('shrub').lods[0].userData.triangles<5000);
    assert.ok(registry.get('bush').lods[0].userData.triangles<5000);
    assert.equal(registry.get('shrub').definition.density,.35);
    for(const asset of registry.values())asset.dispose();
    const expected={geometries,materials};geometries=0;materials=0;
    await assert.rejects(createRegistry([],cache,true),/Simulated missing/);
    assert.equal(geometries,expected.geometries);assert.equal(materials,expected.materials);
    geometries=0;materials=0;
    await assert.rejects(createRegistry([{id:'shrub',definition:{archetype:'shrub'}}],cache,false),/unique safe ID/);
    assert.equal(geometries,expected.geometries);assert.equal(materials,expected.materials);
  }finally{THREE.BufferGeometry.prototype.dispose=originalGeometryDispose;THREE.Material.prototype.dispose=originalMaterialDispose;}
});

test('LOD transition visibility draws complementary adjacent pairs inside fade bands', () => {
  assert.deepEqual([0,43,44,48,52,53,80,95,96,100,104,105,300].map(lodVisibilityMask),[1,1,3,3,3,2,2,2,6,6,6,4,4]);
});

test('color and depth shaders share wind/time/LOD uniforms and material variants across chunks', () => {
  const wind=new WindController({strength:.2,frequency:1,direction:[.7,.3]}),lod=new LodController(48);
  const source=new THREE.MeshStandardMaterial({color:0x648549,side:THREE.DoubleSide});let calls=0;
  source.onBeforeCompile=shader=>{calls++;shader.uniforms.originalHook={value:1};};source.customProgramCacheKey=()=> 'original-custom-program';
  wind.attach(source,2,.08,true);
  const first=lod.bind(source,0,wind,{height:2,amplitude:.08,weighted:true},true);
  const second=lod.bind(source,0,wind,{height:2,amplitude:.08,weighted:true},true);
  assert.equal(first,second);assert.equal(first.material,second.material);assert.equal(first.depth,second.depth);
  assert.notEqual(lod.bind(source,1).material,first.material);
  const shader=()=>({vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}});
  const color=shader(),depth={vertexShader:THREE.ShaderLib.depth.vertexShader,fragmentShader:THREE.ShaderLib.depth.fragmentShader,uniforms:{}};
  first.material.onBeforeCompile(color);first.depth.onBeforeCompile(depth);
  assert.equal(calls,1);assert.equal(color.uniforms.ezTime,depth.uniforms.ezTime);assert.equal(color.uniforms.ezViewerPosition,depth.uniforms.ezViewerPosition);
  assert.match(color.vertexShader,/attribute float windWeight/);assert.match(depth.vertexShader,/attribute float windWeight/);
  assert.match(color.fragmentShader,/ezScreen < ezNearFade/);assert.match(depth.fragmentShader,/ezScreen < ezNearFade/);
  assert.match(first.material.customProgramCacheKey(),/original-custom-program.*ez-wind.*ez-dither/);
  wind.update(7);lod.update({position:new THREE.Vector3(1,2,3)},16);
  assert.equal(depth.uniforms.ezTime.value,7);assert.deepEqual(depth.uniforms.ezViewerPosition.value.toArray(),[1,2,3]);assert.equal(color.uniforms.ezChunkSize.value,16);
  assert.ok(wind.materials.has(source)&&wind.materials.has(first.depth));
  let colorDisposals=0,depthDisposals=0;first.material.addEventListener('dispose',()=>colorDisposals++);first.depth.addEventListener('dispose',()=>depthDisposals++);
  source.dispose();assert.equal(lod.sources.size,0);assert.equal(wind.materials.size,0);assert.equal(colorDisposals,1);assert.equal(depthDisposals,1);
  lod.dispose();wind.dispose();assert.equal(colorDisposals,1);assert.equal(depthDisposals,1);
});
