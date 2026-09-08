import * as THREE from 'three';
import { terrainBlend,terrainTileSize } from './terrain.js';

function pixels(texture,sizeLimit=1024){
  const image=texture.image;
  const canvas=document.createElement('canvas');canvas.width=Math.min(image.width,sizeLimit);canvas.height=Math.min(image.height,sizeLimit);
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('Terrain PBR baking requires a 2D canvas.');
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(image,0,0,canvas.width,canvas.height);return context.getImageData(0,0,canvas.width,canvas.height);
}
const wrap=value=>value-Math.floor(value);
const index=(p,u,v)=>(Math.min(p.height-1,Math.floor(wrap(1-v)*p.height))*p.width+Math.min(p.width-1,Math.floor(wrap(u)*p.width)))*4;
const linear=new Float32Array(256).map((_,i)=>THREE.ColorManagement.convert(new THREE.Color(i/255,i/255,i/255),THREE.SRGBColorSpace,THREE.LinearSRGBColorSpace).r);
const srgb=value=>Math.round(255*(value<=.0031308?value*12.92:1.055*Math.pow(value,1/2.4)-.055));

/** Bake the exact maps used by standard materials in both viewport and glTF.
 * A 65 x 65 blend field avoids millions of terrain/canopy evaluations. Color is
 * mixed in linear light; tangent normals are renormalized; roughness stays linear.
 */
export function bakeTerrainTile(options,tile,sources,size=1024,kinds=['color','normal','roughness']){
  const gridSize=65,field=new Float32Array(gridSize*gridSize);
  for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++)field[y*gridSize+x]=terrainBlend(tile.minX+x/(gridSize-1)*tile.size,tile.minZ+y/(gridSize-1)*tile.size,options);
  const blendAt=(u,v)=>{
    const x=u*(gridSize-1),y=v*(gridSize-1),ix=Math.min(gridSize-2,Math.floor(x)),iy=Math.min(gridSize-2,Math.floor(y)),fx=x-ix,fy=y-iy;
    return (field[iy*gridSize+ix]*(1-fx)+field[iy*gridSize+ix+1]*fx)*(1-fy)+(field[(iy+1)*gridSize+ix]*(1-fx)+field[(iy+1)*gridSize+ix+1]*fx)*fy;
  };
  const result={},tileSize=terrainTileSize(options);
  try{
    for(const kind of kinds){
      const [first,second]=sources[kind],canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d');if(!context)throw new Error('Terrain PBR baking requires a 2D canvas.');
      const output=context.createImageData(size,size),d=output.data;
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        // Endpoints agree exactly across tile edges (including normal maps).
        const u=x/(size-1),v=1-y/(size-1),worldU=(tile.minX+u*tile.size)/tileSize,worldV=(tile.minZ+v*tile.size)/tileSize;
        const a=index(first,worldU,worldV),b=index(second,worldU*.83,worldV*.83),mix=blendAt(u,v),out=(y*size+x)*4;
        if(kind==='normal'){
          const nx=((first.data[a]*(1-mix)+second.data[b]*mix)/255)*2-1,ny=((first.data[a+1]*(1-mix)+second.data[b+1]*mix)/255)*2-1,nz=((first.data[a+2]*(1-mix)+second.data[b+2]*mix)/255)*2-1;
          const length=Math.hypot(nx,ny,nz)||1;d[out]=(nx/length*.5+.5)*255;d[out+1]=(ny/length*.5+.5)*255;d[out+2]=(nz/length*.5+.5)*255;
        }else for(let channel=0;channel<3;channel++)d[out+channel]=kind==='color'?srgb(linear[first.data[a+channel]]*(1-mix)+linear[second.data[b+channel]]*mix):first.data[a+channel]*(1-mix)+second.data[b+channel]*mix;
        d[out+3]=255;
      }
      context.putImageData(output,0,0);
      const texture=new THREE.CanvasTexture(canvas);texture.name=`Terrain ${kind} ${tile.minX},${tile.minZ}`;texture.anisotropy=8;
      texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
      if(kind==='color')texture.colorSpace=THREE.SRGBColorSpace;
      result[kind]=texture;
    }
    return result;
  }catch(error){Object.values(result).forEach(texture=>texture.dispose());throw error;}
}

// Prefilter to the bake's world texel density before repeated sampling, avoiding
// aliasing when a large world contains hundreds of repeats per surface tile.
export function terrainSources(maps,options,tile,size=1024,kinds=['color','normal','roughness']){
  const pixelsPerRepeat=Math.max(1,Math.ceil(size*terrainTileSize(options)/tile.size));
  return Object.fromEntries(kinds.map(kind=>[kind,[pixels(maps.first[kind],pixelsPerRepeat),pixels(maps.second[kind],Math.ceil(pixelsPerRepeat/.83))]]));
}

export function disposeTerrainGround(ground){
  if(!ground)return;
  ground.geometry.dispose();
  const textures=new Set();
  for(const material of new Set(Array.isArray(ground.material)?ground.material:[ground.material])){
    if(material.userData.ownedTerrainTextures)for(const key of ['map','normalMap','roughnessMap'])if(material[key])textures.add(material[key]);
    material.dispose();
  }
  textures.forEach(texture=>texture.dispose());
}
