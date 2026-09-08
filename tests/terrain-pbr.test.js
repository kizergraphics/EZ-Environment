import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTerrainGeometry,terrainBlend } from '../src/app/environment/terrain.js';
import { bakeTerrainTile,disposeTerrainGround } from '../src/app/environment/terrain-bake.js';
import { validateOptions } from '../src/app/environment/options.js';

const options=validateOptions({composition:'biome',biome:'forest',radius:16});
const solid=(r,g,b)=>({width:1,height:1,data:new Uint8ClampedArray([r,g,b,255])});
const sources={color:[solid(30,60,90),solid(200,180,140)],normal:[solid(128,128,255),solid(200,140,230)],roughness:[solid(200,200,200),solid(100,100,100)]};

test('terrain uses portable UV tiles and repeating horizon material groups',()=>{
  const geometry=createTerrainGeometry(options),tiles=geometry.userData.terrainTiles;
  assert.equal(tiles.length,4);assert.deepEqual(geometry.groups.map(g=>g.materialIndex),[0,1,2,3,4,4,4,4]);
  for(const group of geometry.groups.slice(0,4))for(let i=group.start;i<group.start+group.count;i++){
    const vertex=geometry.index.getX(i),uv=geometry.attributes.uv;
    assert.ok(uv.getX(vertex)>=0&&uv.getX(vertex)<=1);assert.ok(uv.getY(vertex)>=0&&uv.getY(vertex)<=1);
  }
  assert.equal(terrainBlend(options.radius*1.25,0,options),0);
  geometry.dispose();
});

test('baked neighboring maps meet exactly and normals remain normalized',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{this.pixels=image.data;}};}})};
  try{
    const left=bakeTerrainTile(options,{minX:-20,minZ:-20,size:20},sources,16),right=bakeTerrainTile(options,{minX:0,minZ:-20,size:20},sources,16);
    for(const kind of Object.keys(left)){
      const a=left[kind].image.pixels,b=right[kind].image.pixels;
      for(let y=0;y<16;y++)assert.deepEqual([...a.slice((y*16+15)*4,(y*16+16)*4)],[...b.slice(y*16*4,y*16*4+4)]);
    }
    assert.equal(left.color.colorSpace,THREE.SRGBColorSpace);assert.equal(left.normal.colorSpace,THREE.NoColorSpace);
    for(let i=0;i<left.normal.image.pixels.length;i+=4){const d=left.normal.image.pixels;assert.ok(Math.abs(Math.hypot(...[d[i],d[i+1],d[i+2]].map(v=>v/255*2-1))-1)<.015);}
    Object.values(left).concat(Object.values(right)).forEach(texture=>texture.dispose());
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('terrain disposal releases owned bakes but retains shared source textures',()=>{
  const geometry=new THREE.PlaneGeometry(),owned=new THREE.MeshStandardMaterial(),shared=new THREE.MeshStandardMaterial();
  owned.userData.ownedTerrainTextures=true;let released=0,sourceReleased=0;
  for(const kind of ['map','normalMap','roughnessMap']){owned[kind]=new THREE.Texture();owned[kind].addEventListener('dispose',()=>released++);shared[kind]=new THREE.Texture();shared[kind].addEventListener('dispose',()=>sourceReleased++);}
  disposeTerrainGround(new THREE.Mesh(geometry,[owned,shared]));assert.equal(released,3);assert.equal(sourceReleased,0);
});
