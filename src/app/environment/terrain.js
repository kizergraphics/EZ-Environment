import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight,terrainNormal,sampleCanopy,sampleMoisture } from './placement.js';
import { noise,biomeNoise } from './random.js';

// The detailed patch covers every placement. A non-overlapping flat ring keeps
// the scenic horizon continuous without wasting tessellation outside the world.
export function createTerrainGeometry(options) {
  const extent=options.radius*2.5,half=extent/2,outer=1000;
  const spacing=options.terrain.amplitude?Math.min(1,options.terrain.scale/24):4;
  const segments=Math.min(1024,Math.max(16,Math.ceil(extent/spacing)));
  const inner=new THREE.PlaneGeometry(extent,extent,segments,segments);inner.rotateX(-Math.PI/2);
  const pieces=[inner];
  for(const [width,depth,x,z] of [[2000,outer-half,0,(outer+half)/2],[2000,outer-half,0,-(outer+half)/2],[outer-half,extent,(outer+half)/2,0],[outer-half,extent,-(outer+half)/2,0]]){
    const g=new THREE.PlaneGeometry(width,depth);g.rotateX(-Math.PI/2);g.translate(x,0,z);pieces.push(g);
  }
  const green=new THREE.Color(0x556343),dirt=new THREE.Color(0x625846),c=new THREE.Color();
  for(const g of pieces){
    const p=g.attributes.position,colors=new Float32Array(p.count*3),blend=new Float32Array(p.count),uv=g.attributes.uv;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i);p.setY(i,terrainHeight(x,z,options)-.015);
      c.copy(green).lerp(dirt,noise(x/16,z/16,options.seed));c.toArray(colors,i*3);
      if(options.composition==='biome'){
        const variation=biomeNoise(x/21,z/21,options.seed),slope=1-terrainNormal(x,z,options)[1];
        const wet=sampleMoisture(x,z,options);
        blend[i]=options.biome==='forest'?Math.min(.85,sampleCanopy(x,z,options)*.45+wet*.35):options.biome==='desert'?Math.max(0,variation-.5)*.7+slope*.8:options.biome==='rocky'?Math.max(0,1-slope*5)*wet*.65:Math.max(0,variation-.75)*.8;
        c.setScalar(.8+variation*.3).toArray(colors,i*3);
        const tileSize=options.biome==='meadow'?1.5:5;
        uv.setXY(i,x/tileSize,z/tileSize);
      }
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.computeVertexNormals();
    g.setAttribute('biomeBlend',new THREE.BufferAttribute(blend,1));
  }
  const result=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}
