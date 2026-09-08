import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight,terrainNormal,sampleCanopy,sampleMoisture } from './placement.js';
import { biomeNoise } from './random.js';

export function terrainBlend(x,z,options){
  const variation=biomeNoise(x/21,z/21,options.seed),slope=1-terrainNormal(x,z,options)[1];
  const wet=sampleMoisture(x,z,options);
  const blend=options.composition!=='biome'?wet*.35:options.biome==='forest'?Math.min(.85,sampleCanopy(x,z,options)*.45+wet*.35):options.biome==='desert'?Math.max(0,variation-.5)*.7+slope*.8:options.biome==='rocky'?Math.max(0,1-slope*5)*wet*.65:Math.max(0,variation-.75)*.8;
  // Meet the repeating horizon's primary surface without a hard blend boundary.
  const half=options.radius*1.25,edge=Math.max(0,Math.min(1,(half-Math.max(Math.abs(x),Math.abs(z)))/(half*.1)));
  return Math.max(0,Math.min(1,blend))*edge;
}
export const terrainTileSize=options=>options.biome==='meadow'?1.5:5;

// Four independently baked patches bound surface memory; the distant ring keeps
// detailed repeating PBR maps rather than stretching a bake across the horizon.
export function createTerrainGeometry(options) {
  const extent=options.radius*2.5,half=extent/2,outer=1000;
  const spacing=options.terrain.amplitude?Math.min(1,options.terrain.scale/24):4;
  const segments=Math.min(512,Math.max(8,Math.ceil(half/spacing)));
  const pieces=[],tiles=[];
  for(let tz=0;tz<2;tz++)for(let tx=0;tx<2;tx++){
    const minX=-half+tx*half,minZ=-half+tz*half;
    const g=new THREE.PlaneGeometry(half,half,segments,segments);g.rotateX(-Math.PI/2);g.translate(minX+half/2,0,minZ+half/2);
    pieces.push(g);tiles.push({minX,minZ,size:half});
  }
  for(const [width,depth,x,z] of [[2000,outer-half,0,(outer+half)/2],[2000,outer-half,0,-(outer+half)/2],[outer-half,extent,(outer+half)/2,0],[outer-half,extent,-(outer+half)/2,0]]){
    const g=new THREE.PlaneGeometry(width,depth);g.rotateX(-Math.PI/2);g.translate(x,0,z);pieces.push(g);
  }
  for(const [piece,g] of pieces.entries()){
    const p=g.attributes.position,colors=new Float32Array(p.count*3),uv=g.attributes.uv,detailUV=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i);p.setY(i,terrainHeight(x,z,options)-.015);
      detailUV[i*2]=x/terrainTileSize(options);detailUV[i*2+1]=z/terrainTileSize(options);
      const tint=.9+biomeNoise(x/21,z/21,options.seed)*.15;
      colors.fill(tint,i*3,i*3+3);
      if(piece<4){const tile=tiles[piece];uv.setXY(i,(x-tile.minX)/tile.size,(z-tile.minZ)/tile.size);}
      else uv.setXY(i,x/terrainTileSize(options),z/terrainTileSize(options));
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    g.setAttribute('uv1',new THREE.BufferAttribute(detailUV,2));
    // Analytic normals are identical on duplicated vertices along tile seams.
    const normals=g.attributes.normal;
    for(let i=0;i<p.count;i++)normals.setXYZ(i,...terrainNormal(p.getX(i),p.getZ(i),options));
  }
  const result=mergeGeometries(pieces,true);pieces.forEach(g=>g.dispose());
  for(const group of result.groups)if(group.materialIndex>=4)group.materialIndex=4;
  result.userData.terrainTiles=tiles;
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}
