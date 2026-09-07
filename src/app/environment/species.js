import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { generatePlant, createPlantDefinition } from '../generators/plants.js';
import { generateRock, createRockDefinition, ROCK_ARCHETYPES } from '../generators/rocks.js';
import { ASSET_PRESETS } from '../generators/catalog.js';
import { disposeObject } from './assets.js';
import { extraSpecies } from './biome-species.js';

export function createGrass(variant = 'medium') {
  const settings = {short:[.55,.8,5],medium:[1,1,7],tall:[1.7,.75,7],clump:[1.15,1.2,11]}[variant];
  if(!settings)throw new Error('Unknown grass variant.');
  const lods = [settings[2],Math.ceil(settings[2]*.55),2].map((blades, lod) => {
    const geometries = [];
    for (let i=0;i<blades;i++) {
      const a = i * 2.39996, x = Math.sin(a)*0.12, z = Math.cos(a)*0.12;
      const h = (0.55 + (i%3)*0.17)*settings[0], w = 0.045*settings[1], bend = 0.14*settings[0];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([x-w,0,z, x+w,0,z, x+w*.55,h*.5,z+bend*.4, x-w*.55,h*.5,z+bend*.4, x,h,z+bend],3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,.5,0,.5,.5,1],2));
      g.setAttribute('windWeight',new THREE.Float32BufferAttribute([0,0,.3,.3,1],1));
      g.setIndex([0,2,1,0,3,2,3,4,2]); g.rotateY(a); g.computeVertexNormals(); geometries.push(g);
    }
    const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
    const group = new THREE.Group(); group.name = `lod${lod}`;
    group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x547d31,roughness:1,side:THREE.DoubleSide})));
    return group;
  });
  return { object3D:lods[0],lods,definition:{version:1,archetype:'grass',variant},definitionHash:`grass-${variant}-v1`,dispose(){lods.forEach(g=>disposeObject(g));} };
}
export function collectMeshes(root) {
  root.updateMatrixWorld(true); const parts = [];
  root.traverse(o => {
    if (o.isMesh) parts.push({geometry:o.geometry,material:o.material,matrix:o.matrixWorld.clone()});
  });
  return parts;
}
export function makeSpecies(kind, definition) {
  // Explicit authored definitions take precedence over fixed legacy species.
  if(definition && !(kind==='grass'&&definition.height===undefined) && kind!=='fallen_log'){
    if(ROCK_ARCHETYPES.includes(kind))return generateRock(definition);
    return compactPlant(generatePlant(definition));
  }
  const extra=extraSpecies(kind);if(extra)return extra;
  if (kind === 'grass') return createGrass(definition?.variant);
  if (ROCK_ARCHETYPES.includes(kind)) return generateRock(definition || createRockDefinition(kind));
  return compactPlant(generatePlant(definition || createPlantDefinition(kind)));
}
// Mapless foliage uses identical PBR responses. Bake each material's linear color
// into vertices, preserving every triangle while allowing one draw per instance batch.
export function compactPlant(asset) {
  const lods=[];
  for(const source of asset.lods){
    const parts=collectMeshes(source);
    if(parts.some(p=>Array.isArray(p.material)||p.material.map)){lods.forEach(l=>disposeObject(l));return asset;}
    const geometries=parts.map(({geometry,material,matrix})=>{
      const g=geometry.clone().applyMatrix4(matrix),count=g.attributes.position.count,old=g.attributes.color,colors=[];
      for(let i=0;i<count;i++)colors.push((old&&material.vertexColors?old.getX(i):1)*material.color.r,(old&&material.vertexColors?old.getY(i):1)*material.color.g,(old&&material.vertexColors?old.getZ(i):1)*material.color.b);
      g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      if(!g.attributes.windWeight)g.setAttribute('windWeight',new THREE.Float32BufferAttribute(new Float32Array(count),1));
      if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(count*2),2));
      return g;
    });
    const g=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());
    if(!g){lods.forEach(l=>disposeObject(l));return asset;}
    const group=new THREE.Group();group.name=source.name;group.userData=structuredClone(source.userData);
    const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,vertexColors:true,side:THREE.DoubleSide});
    m.userData={vegetation:true,wind:source.userData.wind!==false};
    group.add(new THREE.Mesh(g,m));lods.push(group);
  }
  const result={...asset,object3D:lods[0],lods};asset.dispose();
  let disposed=false;result.dispose=()=>{if(disposed)return;disposed=true;lods.forEach(l=>disposeObject(l));};
  return result;
}
export async function createRegistry(custom, cache, useModels = true) {
  const registry = new Map();
  try {
  for (const kind of ['grass','flower','shrub','bush','sapling','fern','weed','groundCover','rock','boulder','pebble']) {
    // Authoring keeps the rich presets; repeated environment plants use a compact silhouette.
    const definition = ['shrub','bush'].includes(kind) ? createPlantDefinition(kind,{density:.35,branches:3,stemCount:3}) : undefined;
    registry.set(kind,makeSpecies(kind,definition));
  }
  for(const variant of ['short','tall','clump'])registry.set(`grass_${variant}`,createGrass(variant));
  for(const kind of ['dry_shrub','cactus','fallen_log','sandstone','sandstone_outcrop','desert_pebble','rock_outcrop'])registry.set(kind,makeSpecies(kind));
  for(const preset of ASSET_PRESETS)registry.set(preset.id,makeSpecies(preset.definition.archetype,preset.definition));
  if (useModels) {
    for (const name of ['white','blue','yellow']) {
      const source = await cache.load(`/models/flower_${name}.glb`);
      const lods = [0,1,2].map(i => {
        const g = source.clone(true); g.name = `lod${i}`;
        const box = new THREE.Box3().setFromObject(g), height = Math.max(0.01,box.max.y-box.min.y);
        g.scale.setScalar(0.7 / height); g.position.y = -box.min.y*g.scale.x;
        g.traverse(o => { if(o.isMesh) { o.material = o.material.clone(); o.material.roughness = 1; o.material.metalness = 0; o.material.transparent = false; o.material.alphaTest = 0.5; } });
        return g;
      });
      registry.set(`flower_${name}`,{object3D:lods[0],lods,definition:{source:`flower_${name}`},definitionHash:`flower-${name}`,dispose(){lods.forEach(g=>g.traverse(o=>{if(o.material)o.material.dispose();}));}});
    }
  }
  for (const entry of custom) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || registry.has(entry.id)) throw new Error('Custom species must have a unique safe ID.');
    registry.set(entry.id,makeSpecies(entry.definition.archetype,entry.definition));
  }
  return registry;
  } catch(error) {
    for (const asset of registry.values()) asset.dispose();
    registry.clear();
    throw error;
  }
}
