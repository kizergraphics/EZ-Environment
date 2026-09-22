import * as THREE from 'three';
import { Skybox } from '../skybox.js';
import { validateOptions, QUALITY, LAYERS } from './options.js';
import { generatePlacement } from './placement.js';
import { createRegistry, collectMeshes } from './species.js';
import { EnvironmentAssetCache } from './assets.js';
import { WindController } from './wind.js';
import { LodController, lodVisibilityMask } from './lod.js';
import { createTerrainGeometry } from './terrain.js';
import { BiomeMaterials, disposeTerrainGround } from './materials.js';
import { BiomeGrove } from './grove.js';
import { biomeTreeRecords,withBiomeSources } from './biome-placement.js';
import { addFoliageVariants, selectAssetAppearance } from './biome-species.js';
import { prepareAssetMaterials } from '../materials/pbr.js';
import { awaitTextureReadiness } from '../materials/readiness.js';
import { hash } from './random.js';
import { ROCK_PRESETS, rockVariantIndex, selectRockVariant } from '../generators/rocks.js';

export class EnvironmentController extends THREE.Group {
  constructor(options = {}) {
    super(); this.name = 'Environment'; this.object3D = this;
    this.options = validateOptions(options); this.ready = false; this.loading = false; this.error = null;
    this.cache = new EnvironmentAssetCache(); this.wind = new WindController(this.options.wind);
    this.lod = new LodController(this.options.chunkSize);
    this.batches = new Map(); this.registry = new Map(); this._generation = 0; this._disposed = false;
    this.skybox = new Skybox(); this.add(this.skybox);
    this.content = new THREE.Group(); this.add(this.content);
    this.biomeMaterials=new BiomeMaterials();this.grove=new BiomeGrove(this.wind);this.add(this.grove.root);
    this.stats = {instances:0,drawCalls:0,triangles:0,chunks:0,updateMs:0,shortfall:0};
    this._world = new THREE.Vector3();
    // Retain the existing tree editor's grass-count control during migration.
    const owner = this;
    this.grass = { get instanceCount(){return Math.min(QUALITY[owner.options.quality].grass,owner.placement?.count.grass||0);},set instanceCount(n){
      if(!Number.isFinite(n))return;
      owner.options.layers.grass.density = Math.max(0,Math.min(2,n/(Math.PI*owner.options.radius**2)));
      clearTimeout(owner._grassTimer); owner._grassTimer = setTimeout(()=>owner.regenerate().catch(e=>owner.report(e)),160);
    }};
  }
  report(error) { this.error = error; this.onStatus?.({loading:this.loading,error,stats:this.stats}); }
  initialize() {
    if(this._disposed) return Promise.reject(new Error('Environment has been disposed.'));
    if(this.ready) return Promise.resolve(this);
    if(this._initializing) return this._initializing;
    this.loading = true; this.error = null;
    this._initializing = (async()=>{
      if(!this.registry.size){
        const registry=await createRegistry(this.options.customSpecies,this.cache);
        try {
          for (const asset of registry.values()) {
            if (asset.variants?.length) for (const variant of asset.variants) await prepareAssetMaterials(variant);
            else await prepareAssetMaterials(asset);
          }
        }
        catch (error) { for (const asset of registry.values()) asset.dispose(); throw error; }
        if(this._disposed){for(const asset of registry.values())asset.dispose();throw new Error('Environment initialization was canceled after disposal.');}
        this.registry=registry;
        this.foliageTextures=await addFoliageVariants(registry);
        this.grove.foliageMap=registry.get('shrub')?.photoLods?.[0].children[0].material.map;
      }
      await this.regenerate();
      if(this._disposed)throw new Error('Environment initialization was canceled after disposal.');
      this.ready = true; return this;
    })().catch(e=>{this.report(e);throw e;}).finally(()=>{this.loading=false;this._initializing=null;});
    return this._initializing;
  }
  async setOptions(patch) {
    const next = validateOptions({...this.options,...patch,layers:{...this.options.layers,...patch.layers}});
    if(this.registry.size)for(const layer of Object.values(next.layers))for(const id of [layer.species,...layer.speciesChoices.map(c=>c.id)])if(!this.registry.has(id))throw new Error(`Unknown species: ${id}`);
    const previous=this.options;
    this.options = next;
    try{return await this.regenerate();}catch(error){if(this.options===next)this.options=previous;throw error;}
  }
  async regenerate(dirty = null) {
    if(this._disposed)throw new Error('Environment is disposed.');
    const id = ++this._generation;
    this.loading = true;this.error=null;this.onStatus?.({loading:true});
    // Cancel any stale build and settle its waiting caller.
    this._cancelBuild?.();
    this.beforeRegenerate?.();
    const records=biomeTreeRecords(this.options);
    const options = withBiomeSources(structuredClone(this.options),records);
    const {quality,appearance,lighting,modified,...placementOptions}=options;
    const placementKey=hash(placementOptions);
    let result;
    try {
      const groundMaps=await this.biomeMaterials.prepare(options);
      if(id!==this._generation||this._disposed)return;
      if(this.placement&&this._placementKey===placementKey)result=this.placement;
      else if(typeof Worker !== 'undefined') {
        result = await new Promise((resolve,reject)=>{
          const w = new Worker(new URL('./placement.worker.js',import.meta.url),{type:'module'});
          this._cancelBuild = ()=>{w.terminate();resolve(null);};
          w.onmessage=({data})=>{w.terminate();if(data.error)reject(new Error(data.error));else resolve(data.result);};
          w.onerror=e=>{w.terminate();reject(new Error(e.message||'Placement worker failed.'));};
          w.postMessage({id,options,previous:dirty?this.placement:null,dirty});
        });
      } else result = generatePlacement(options,dirty?this.placement:null,dirty);
      if(!result||id!==this._generation||this._disposed)return;
      this._cancelBuild=null;
      // Build replacements off-scene; old world remains usable until successful completion.
      const replacements = new Map();
      let nextGround=null,nextGrove=null;
      try {
        for(const [key,chunk] of result.chunks){
          if(dirty&&!dirty.has(key)&&this.batches.has(key))continue;
          replacements.set(key,this.buildChunk(chunk,result,options));
          if(replacements.size%4===0) await new Promise(r=>setTimeout(r,0));
          if(id!==this._generation){for(const b of replacements.values())this.releaseBatch(b);return;}
        }
        if(!dirty){nextGround=this.createGround(options,groundMaps);nextGrove=this.grove.build(records,options);}
        if(nextGrove) await awaitTextureReadiness(nextGrove.exportRoot);
        if(id!==this._generation||this._disposed){for(const b of replacements.values())this.releaseBatch(b);disposeTerrainGround(nextGround);if(nextGrove){this.grove.release(nextGrove.root);this.grove.release(nextGrove.exportRoot);}return;}
      } catch(e){for(const b of replacements.values())this.releaseBatch(b);disposeTerrainGround(nextGround);if(nextGrove)this.grove.release(nextGrove.root);throw e;}
      for(const [key,b]of this.batches)if(!result.chunks.has(key)||replacements.has(key)){this.releaseBatch(b);this.batches.delete(key);}
      for(const [key,b]of replacements){this.batches.set(key,b);this.content.add(b.root);}
      this.placement = result;
      this._placementKey=placementKey;this.options=options;
      if(nextGrove){this.grove.commit(nextGrove);this.add(this.grove.root);this.exportObjects=[...(this.exportObjects||[]).filter(e=>e.id!=='biome-trees'),...(records.length?[{id:'biome-trees',object:this.grove.exportRoot}]:[])];}
      this.applyStoneMaterials(groundMaps,options);
      if(nextGround)this.makeGround(nextGround);
      this.applyGrassPalette(options);
      this.stats.shortfall=[...result.chunks.values()].reduce((sum,c)=>sum+LAYERS.reduce((s,l)=>s+c.layers[l].shortfall,0),0);
      this.ready=true;
    } catch(e){if(id===this._generation)this.report(e);throw e;}
    finally{if(id===this._generation){this.loading=false;this.onStatus?.({loading:false,error:this.error,stats:this.stats});}}
  }
  buildChunk(chunk,placement,options=this.options) {
    const root = new THREE.Group();root.name=`chunk_${chunk.x}_${chunk.z}`;
    try{
    const q=QUALITY[options.quality], bounds=options.chunkSize;
    const batch={root,center:new THREE.Vector3((chunk.x+.5)*bounds,0,(chunk.z+.5)*bounds),level:-1,mask:0,levels:[]};
    const transform=new THREE.Object3D(), rotation=new THREE.Quaternion(), up=new THREE.Vector3(0,1,0), normal=new THREE.Vector3(), matrix=new THREE.Matrix4(), color=new THREE.Color();
    for(let level=0;level<3;level++){
      const group=new THREE.Group();group.name=`lod${level}`;group.visible=false;let instances=0,triangles=0,calls=0;
      for(const layer of LAYERS){
        const records=chunk.layers[layer].records;
        const baseLimit=Math.min(records.length,Math.floor(records.length*Math.min(1,q[layer]/Math.max(1,placement.count[layer]))));
        const densityFactor=['grass','flowers','pebbles'].includes(layer)?(options.composition==='biome'&&layer==='grass'?[1,.8,.55]:[1,.55,.2])[level]:1;
        const count=Math.floor(baseLimit*densityFactor);if(!count)continue;
        const selected=records.slice(0,count),bySpecies=new Map();
        for(const record of selected){
          const id=record.species||options.layers[layer].species,asset=this.registry.get(id);
          // Preserve authored silhouette diversity up close, then collapse the
          // distant LODs back into one instanced draw per species. Splitting all
          // three variants at every distance makes tiny rocks and pebbles pay
          // the same draw-call cost as foreground assets.
          const variant=rockVariantIndex(asset,record.variationSeed,level),key=`${id}\u0000${variant}`;
          if(!bySpecies.has(key))bySpecies.set(key,{id,variant,records:[]});
          bySpecies.get(key).records.push(record);
        }
        for(const {id,variant,records:speciesRecords} of bySpecies.values()){
        const asset=this.registry.get(id);
        if(!asset)throw new Error(`Unknown species: ${id}`);
        const selectedAsset=selectRockVariant(selectAssetAppearance(asset,options),variant);
        const source=selectedAsset.lods[level]||selectedAsset.object3D, parts=collectMeshes(source);
        const isPlant=['grass','flowers','plants'].includes(layer)&&source.userData.wind!==false;
        for(const part of parts){
          const castShadow=q.shadows&&layer!=='grass'&&layer!=='flowers'&&layer!=='pebbles'&&(level===0||options.composition==='biome'&&(layer==='boulders'||layer==='rocks'&&level===1));
          let windSpec=null;
          if(isPlant){
            part.geometry.computeBoundingBox();const height=part.geometry.boundingBox.max.y;
            windSpec={height,amplitude:layer==='grass'?.25:.08,weighted:!!part.geometry.attributes.windWeight};
            this.wind.attach(part.material,windSpec.height,windSpec.amplitude,windSpec.weighted);
          }
          const binding=this.lod.bind(part.material,level,isPlant?this.wind:null,windSpec,castShadow);
          const mesh=new THREE.InstancedMesh(part.geometry,binding.material,speciesRecords.length);mesh.name=`${layer}_${id}${asset.variants?.length?`__v${variant+1}`:''}`;
          mesh.receiveShadow=true;mesh.castShadow=castShadow;if(binding.depth)mesh.customDepthMaterial=binding.depth;
          for(let i=0;i<speciesRecords.length;i++){
            const r=speciesRecords[i]; transform.position.fromArray(r.position);transform.scale.fromArray(r.scale);
            normal.fromArray(r.normal);transform.quaternion.setFromUnitVectors(up,normal);rotation.setFromAxisAngle(up,r.yaw);transform.quaternion.multiply(rotation);transform.updateMatrix();
            matrix.multiplyMatrices(transform.matrix,part.matrix);mesh.setMatrixAt(i,matrix);
            color.setRGB(r.tint,r.tint,r.tint);mesh.setColorAt(i,color);
          }
          mesh.count=speciesRecords.length;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
          group.add(mesh);calls++;triangles+=(part.geometry.index?.count||part.geometry.attributes.position.count)/3*speciesRecords.length;
        }
        }
        instances+=count;
      }
      root.add(group);batch.levels.push({group,instances,triangles,calls});
    }
    return batch;
    }catch(error){root.traverse(o=>{if(o.isInstancedMesh)o.dispose();});throw error;}
  }
  releaseBatch(b){b.root.removeFromParent();b.root.traverse(o=>{if(o.isInstancedMesh)o.dispose();});}
  createGround(options=this.options,maps=null){
    const g=createTerrainGeometry(options);
    try { const ground=new THREE.Mesh(g,this.biomeMaterials.ground(options,maps,g));ground.name='Terrain';ground.receiveShadow=true;return ground; }
    catch (error) { g.dispose(); throw error; }
  }
  applyStoneMaterials(maps,options){
    if (!maps?.stone) return;
    for(const id of ['rock','boulder','pebble','sandstone','sandstone_outcrop','desert_pebble','rock_outcrop',...ROCK_PRESETS.map(p=>p.id)]){
      const asset=this.registry.get(id);if(!asset)continue;
      for(const lod of asset.lods)for(const {material} of collectMeshes(lod)){
        const all=[material,...[...(this.lod.sources.get(material)?.levels.values()||[])].map(b=>b.material)];
        for(const m of all){if(m.userData.pbrFamily)continue;m.map=maps.stone.color;m.normalMap=maps.stone.normal;m.roughnessMap=maps.stone.roughness;m.normalScale.setScalar(options.appearance==='photorealistic'?.8:.3);m.needsUpdate=true;}
      }
    }
  }
  makeGround(ground=this.createGround()){
    if(this.ground){this.ground.removeFromParent();disposeTerrainGround(this.ground);}
    this.ground=ground;this.add(ground);
    try{this.onTerrainChanged?.(this.options);}catch(error){this.report(new Error(`Terrain changed, but its observer failed: ${error.message}`));}
  }
  applyGrassPalette(options){
    const grass=options.layers.grass,color=new THREE.Color(grass.color).lerp(new THREE.Color('#b5a65f'),grass.dryness);
    for(const id of new Set([grass.species,...grass.speciesChoices.map(c=>c.id)])){
      const asset=this.registry.get(id);if(!asset)continue;
      const palette=asset.definition.archetype==='grass'&&asset.definition.height!==undefined?new THREE.Color(asset.definition.leafColor):null;
      for(const lod of asset.lods)for(const part of collectMeshes(lod)){
        const family=part.material.userData.pbrFamily;
        if (family && !['foliage','grassCards'].includes(family)) continue;
        const baseline=family==='grassCards'?new THREE.Color(part.material.userData.pbrBaselineTint||'#698446'):palette&&!family?palette:null;
        if(baseline)part.material.color.setRGB(
          Math.min(1,color.r/Math.max(.001,baseline.r)),
          Math.min(1,color.g/Math.max(.001,baseline.g)),
          Math.min(1,color.b/Math.max(.001,baseline.b)),
        );
        else part.material.color.copy(color);
        const entry=this.lod.sources.get(part.material);if(entry)for(const binding of entry.levels.values())binding.material.color.copy(part.material.color);
      }
    }
  }
  async addSpecies(id,asset,layer){
    if(this.registry.has(id))throw new Error('Species already exists.');
    try { await prepareAssetMaterials(asset); } catch (error) { asset.dispose(); throw error; }
    this.registry.set(id,asset);
    try{await this.setOptions({customSpecies:[...this.options.customSpecies,{id,definition:structuredClone(asset.definition)}],layers:{[layer]:{...this.options.layers[layer],species:id,speciesChoices:[]}}});}
    catch(error){this.registry.delete(id);asset.dispose();throw error;}
  }
  async paint(stroke){
    const next=validateOptions({...this.options,brushes:[...this.options.brushes,stroke]});this.options=next;
    const dirty=new Set();
    for(const[key,c]of this.placement.chunks){const s=next.chunkSize,r=stroke.radius+(!stroke.layer||['rocks','boulders'].includes(stroke.layer)?s:0);if(stroke.x+r>=c.x*s&&stroke.x-r<=(c.x+1)*s&&stroke.z+r>=c.z*s&&stroke.z-r<=(c.z+1)*s)dirty.add(key);}
    return this.regenerate(dirty);
  }
  update(elapsedTime,camera){
    const start=performance.now();this.wind.update(elapsedTime,this.options.wind);this.lod.update(camera,this.options.chunkSize);
    if(camera)this.grove.update(camera,elapsedTime,this.options);
    let instances=0,calls=0,triangles=0,chunks=0;const far=QUALITY[this.options.quality].distance;
    for(const b of this.batches.values()){
      const distance=camera?camera.position.distanceTo(b.center):0;
      let level=distance<48?0:distance<100?1:2;
      if(b.level>=0&&b.level!==level){const boundary=level>b.level?(b.level===0?48:100):(level===0?48:100);if(Math.abs(distance-boundary)<5)level=b.level;}
      b.root.visible=distance<far+this.options.chunkSize;
      const mask=lodVisibilityMask(distance);
      if(mask!==b.mask){for(let i=0;i<3;i++)b.levels[i].group.visible=!!(mask&(1<<i));b.mask=mask;}
      b.level=level;
      if(b.root.visible){for(let i=0;i<3;i++)if(mask&(1<<i)){const l=b.levels[i];instances+=l.instances;calls+=l.calls;triangles+=l.triangles;}chunks++;}
    }
    this.stats.instances=instances;this.stats.drawCalls=calls;this.stats.triangles=triangles;this.stats.chunks=chunks;this.stats.updateMs=performance.now()-start;
  }
  dispose(){
    if(this._disposed)return;this._disposed=true;this._generation++;this._cancelBuild?.();clearTimeout(this._grassTimer);
    for(const b of this.batches.values())this.releaseBatch(b);this.batches.clear();
    for(const a of this.registry.values())a.dispose();this.registry.clear();this.cache.dispose();this.lod.dispose();this.wind.dispose();
    disposeTerrainGround(this.ground);this.skybox.geometry.dispose();this.skybox.material.dispose();this.skybox.sun.shadow.map?.dispose();
    this.grove.dispose();this.biomeMaterials.dispose();this.foliageTextures?.dispose();
    this.removeFromParent();this.clear();this.ready=false;
  }
}
