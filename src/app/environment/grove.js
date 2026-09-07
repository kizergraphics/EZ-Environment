import * as THREE from 'three';
import { Tree } from 'ez-environment';
import { loadPresetWithTextures } from '../textures.js';
import { disposeObject } from './assets.js';
import { QUALITY } from './options.js';

// Batches borrow six stable prototypes per tree family. Only instance buffers are replaced.
export class BiomeGrove {
  constructor(wind){this.wind=wind;this.prototypes=new Map();this.root=new THREE.Group();this.root.name='Biome trees';this.batches=[];this.records=[];this.lastUpdate=-Infinity;this.depths=new Set();this.depthByMaterial=new WeakMap();}
  prototype(record){
    const key=`${record.preset}:${record.variant}`;
    if(!this.prototypes.has(key)){
      const t=new Tree();loadPresetWithTextures(t,record.preset,false);t.options.seed=913+record.variant*887;
      const pine=/Pine/.test(record.preset);
      t.options.branch.children[0]=Math.min(pine?52:7,t.options.branch.children[0]);t.options.branch.children[1]=Math.min(4,t.options.branch.children[1]);t.options.leaves.count=Math.min(pine?18:20,t.options.leaves.count);t.options.leaves.size*=1.12;
      t.generateLODs([{distance:0,detail:{sectionStride:2,segmentFactor:.75}},{distance:65,detail:{sectionStride:3,segmentFactor:.5,leafStride:2,leafScale:1.35,billboard:'single'}},{distance:140,detail:{sectionStride:5,segmentFactor:.4,leafStride:5,leafScale:1.9,billboard:'single'}}]);
      const lod=t.children.find(c=>c.isLOD);
      const levels=lod.levels.map(l=>l.object);
      const height=new THREE.Box3().setFromObject(levels[0]).max.y;
      const scale=(/Small/.test(record.preset)?11:22)/Math.max(1,height),seen=new Set(),materials=new Set();
      for(const level of levels)level.traverse(m=>{if(m.isMesh){
        if(!seen.has(m.geometry)){m.geometry.scale(scale,scale,scale);seen.add(m.geometry);}
        if(!materials.has(m.material)){
          materials.add(m.material);m.material.onBeforeCompile=()=>{};m.material.customProgramCacheKey=()=> 'grove-standard';m.material.needsUpdate=true;
          const h=/Small/.test(record.preset)?11:22;this.wind?.attach(m.material,h,.18);
          const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map:m.material.map,alphaTest:m.material.alphaTest,side:THREE.DoubleSide});this.wind?.attach(depth,h,.18);this.depths.add(depth);this.depthByMaterial.set(m.material,depth);
        }
      }});
      this.prototypes.set(key,{tree:t,levels,leafMaterial:t.leavesMesh.material,leafMap:t.leavesMesh.material.map,pine});
    }
    return this.prototypes.get(key);
  }
  build(records,options){
    const root=new THREE.Group(),exportRoot=new THREE.Group(),batches=[],groups=new Map(),transform=new THREE.Object3D();root.name='Biome trees';exportRoot.name='Biome trees';
    try{
      for(const record of records){const key=`${record.preset}:${record.variant}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record);}
      for(const list of groups.values()){
        const proto=this.prototype(list[0]),levels=[];
        proto.leafMaterial.map=options.appearance==='photorealistic'&&!proto.pine&&this.foliageMap?this.foliageMap:proto.leafMap;
        this.depthByMaterial.get(proto.leafMaterial).map=proto.leafMaterial.map;
        for(let level=0;level<3;level++){
          const meshes=[];
          proto.levels[level].traverse(part=>{if(!part.isMesh)return;
            const mesh=new THREE.InstancedMesh(part.geometry,part.material,list.length);mesh.name=`grove-lod${level}`;mesh.receiveShadow=true;mesh.castShadow=QUALITY[options.quality].shadows&&level<2;
            mesh.customDepthMaterial=this.depthByMaterial.get(part.material);
            const matrices=list.map(r=>{transform.position.set(r.x,r.y,r.z);transform.rotation.set(0,r.yaw,0);transform.scale.setScalar(r.scale);transform.updateMatrix();return transform.matrix.clone();});
            matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.computeBoundingSphere();mesh.computeBoundingBox();mesh.count=level===0?list.length:0;root.add(mesh);meshes.push({mesh,matrices});
            if(level===0)exportRoot.add(mesh.clone());
          });levels.push(meshes);
        }
        batches.push({records:list,levels});
      }
      return {root,exportRoot,batches,records};
    }catch(error){this.release(root);this.release(exportRoot);throw error;}
  }
  commit(next){this.release(this.root);this.release(this.exportRoot);this.root=next.root;this.exportRoot=next.exportRoot;this.batches=next.batches;this.records=next.records;this.lastUpdate=-Infinity;}
  update(camera,time,options){
    if(time-this.lastUpdate<.15)return;this.lastUpdate=time;
    for(const batch of this.batches){
      const lists=[[],[],[]];
      batch.records.forEach((r,i)=>{const d=Math.hypot(camera.position.x-r.x,camera.position.y-r.y,camera.position.z-r.z);if(d<QUALITY[options.quality].distance+80)lists[d<65?0:d<140?1:2].push(i);});
      batch.levels.forEach((parts,level)=>parts.forEach(({mesh,matrices})=>{lists[level].forEach((index,i)=>mesh.setMatrixAt(i,matrices[index]));mesh.count=lists[level].length;mesh.instanceMatrix.needsUpdate=true;}));
    }
  }
  release(root){root?.removeFromParent();root?.traverse(o=>{if(o.isInstancedMesh)o.dispose();});}
  dispose(){this.release(this.root);this.release(this.exportRoot);for(const p of this.prototypes.values())disposeObject(p.tree);for(const m of this.depths)m.dispose();this.depths.clear();this.prototypes.clear();}
}
