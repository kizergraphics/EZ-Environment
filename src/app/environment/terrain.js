import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight,terrainNormal,sampleMoisture } from './placement.js';
import { biomeNoise } from './random.js';
import { MEADOW } from './biomes.js';

export function terrainBlend(x,z,options){
  const blend = options.composition === 'biome'
    ? Math.max(0, biomeNoise(x / 21, z / 21, options.seed) - .75) * .8
    : sampleMoisture(x, z, options) * .35;
  // Meet the repeating horizon's primary surface without a hard blend boundary.
  const half=options.radius*1.25,edge=Math.max(0,Math.min(1,(half-Math.max(Math.abs(x),Math.abs(z)))/(half*.1)));
  return Math.max(0,Math.min(1,blend))*edge;
}
export const TERRAIN_TILE_SIZE = 1.5;

// Sample the broad biome color changes on a fixed grid. Vertex colors carry
// those changes into both the viewport and standard glTF materials.
function terrainTintField(options, half) {
  const size = 65;
  const field = new Float32Array(size * size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      field[z * size + x] = terrainBlend(
        (x / (size - 1) * 2 - 1) * half, (z / (size - 1) * 2 - 1) * half, options,
      );
    }
  }
  return (x, z) => {
    const u = THREE.MathUtils.clamp((x / half + 1) * .5 * (size - 1), 0, size - 1);
    const v = THREE.MathUtils.clamp((z / half + 1) * .5 * (size - 1), 0, size - 1);
    const i = Math.min(size - 2, Math.floor(u)), j = Math.min(size - 2, Math.floor(v));
    const a = THREE.MathUtils.lerp(field[j * size + i], field[j * size + i + 1], u - i);
    const b = THREE.MathUtils.lerp(field[(j + 1) * size + i], field[(j + 1) * size + i + 1], u - i);
    return THREE.MathUtils.lerp(a, b, v - j);
  };
}

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
  const [base, accent] = MEADOW.colors.map(color => new THREE.Color(color));
  const variation = new THREE.Color().setRGB(accent.r / base.r, accent.g / base.g, accent.b / base.b);
  const tintAt = terrainTintField(options, half);
  for (const g of pieces) {
    const p = g.attributes.position, uv = g.attributes.uv, normals = g.attributes.normal;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, terrainHeight(x, z, options) - .015);
      normals.setXYZ(i, ...terrainNormal(x, z, options));
      uv.setXY(i, x / TERRAIN_TILE_SIZE, z / TERRAIN_TILE_SIZE);
      const shade = .9 + biomeNoise(x / 21, z / 21, options.seed) * .1;
      const blend = tintAt(x, z);
      colors[i * 3] = Math.min(1, shade * THREE.MathUtils.lerp(1, variation.r, blend));
      colors[i * 3 + 1] = Math.min(1, shade * THREE.MathUtils.lerp(1, variation.g, blend));
      colors[i * 3 + 2] = Math.min(1, shade * THREE.MathUtils.lerp(1, variation.b, blend));
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const result = mergeGeometries(pieces);
  pieces.forEach(g => g.dispose());
  result.userData.terrainTiles=tiles;
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}
