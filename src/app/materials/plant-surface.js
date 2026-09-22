import * as THREE from 'three';
import { LEAF_TEXTURE_REGISTRY, leafTextureInfo, legacyLeafTexture } from '../generators/leaf-textures.js';
import grassAtlas from '../generators/grass-atlas-v2.json' with { type: 'json' };

const leafSources = new Map();
const grassSources = new Map();

/** Whole leaf interiors, not branch atlases: each generated blade gets matching venation. */
export async function loadLeafSurface(id = 'legacy-broad') {
  const resolvedId=LEAF_TEXTURE_REGISTRY[id]?id:legacyLeafTexture(id);
  const definition=leafTextureInfo(resolvedId);
  if (!leafSources.has(resolvedId)) leafSources.set(resolvedId, (async () => {
    const source = await new THREE.TextureLoader().loadAsync(definition.path);
    try {
      const size = 1024, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.drawImage(source.image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size), luminance = new Float32Array(size * size);
      let mean = 0;
      for (let i = 0; i < luminance.length; i++) {
        const p = i * 4;
        luminance[i] = pixels.data[p] * .2126 + pixels.data[p + 1] * .7152 + pixels.data[p + 2] * .0722;
        mean += luminance[i];
      }
      mean /= luminance.length;
      const color = definition.atlasCells>1?new Uint8ClampedArray(pixels.data):new Uint8ClampedArray(pixels.data.length), normal = new Uint8ClampedArray(pixels.data.length), roughness = new Uint8ClampedArray(pixels.data.length);
      const sample = (x, y) => luminance[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x, p = i * 4, detail = luminance[i] - mean;
        // Legacy sources remain tint-compatible. Species atlases retain their
        // authored color, with material color applied relative to baseline tint.
        if(definition.atlasCells===1){const shade = Math.max(65, Math.min(255, 181 + detail * 2.65));color.set([shade, Math.min(255, shade + 3), Math.max(0, shade - 5), 255], p);}
        const dx = (sample(x + 2, y) - sample(x - 2, y)) / 130;
        const dy = (sample(x, y + 2) - sample(x, y - 2)) / 130;
        const length = Math.hypot(dx, dy, 1);
        normal.set([127.5 * (1 - dx / length), 127.5 * (1 + dy / length), 127.5 * (1 + 1 / length), 255], p);
        const r = Math.max(130, Math.min(245, 205 - detail * (.4+definition.normalStrength*.45)));
        roughness.set([r, r, r, 255], p);
      }
      const texture = (data, name, srgb = false) => {
        const image = document.createElement('canvas'); image.width = image.height = size;
        image.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
        const map = new THREE.CanvasTexture(image); map.name = `Leaf surface ${name}`;
        map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        map.wrapS = map.wrapT = definition.atlasCells>1?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping; map.anisotropy = 8;
        // Source base is at the bottom of the image and generated blade v=0.
        map.flipY = true; map.userData = { leafTexture:resolvedId, atlasCells:definition.atlasCells };
        return map;
      };
      return { map: texture(color, 'color', true), normalMap: texture(normal, 'normal'), roughnessMap: texture(roughness, 'roughness') };
    } finally { source.dispose(); }
  })().catch(error => { leafSources.delete(resolvedId); throw new Error(`Leaf surface texture failed to load: ${error.message}`); }));
  return leafSources.get(resolvedId);
}

/** Shared alpha atlas for grass cards, with matching artistic normal and roughness maps. */
export async function loadGrassCardSurface(id = 'meadow-v1') {
  if(id!=='meadow-v1')throw new Error(`Unknown grass atlas: ${id}`);
  if(!grassSources.has(id))grassSources.set(id,(async()=>{
    const map=await new THREE.TextureLoader().loadAsync(grassAtlas.path);
    try{
      const source=map.image,sizeX=source.naturalWidth||source.width,sizeY=source.naturalHeight||source.height;
      const canvas=document.createElement('canvas');canvas.width=sizeX;canvas.height=sizeY;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source,0,0);
      const pixels=context.getImageData(0,0,sizeX,sizeY),luminance=new Float32Array(sizeX*sizeY);
      for(let i=0;i<luminance.length;i++){
        const p=i*4,a=pixels.data[p+3]/255;
        luminance[i]=(pixels.data[p]*.2126+pixels.data[p+1]*.7152+pixels.data[p+2]*.0722)*a;
      }
      const normal=new Uint8ClampedArray(pixels.data.length),roughness=normal.slice();
      const sample=(x,y)=>luminance[Math.max(0,Math.min(sizeY-1,y))*sizeX+Math.max(0,Math.min(sizeX-1,x))];
      for(let y=0;y<sizeY;y++)for(let x=0;x<sizeX;x++){
        const i=y*sizeX+x,p=i*4,a=pixels.data[p+3],dx=(sample(x+1,y)-sample(x-1,y))/255,dy=(sample(x,y+1)-sample(x,y-1))/255,length=Math.hypot(dx*.18,dy*.18,1);
        normal.set([127.5*(1-dx*.18/length),127.5*(1+dy*.18/length),127.5*(1+1/length),255],p);
        const r=Math.max(180,Math.min(245,225-(luminance[i]-100)*.12));roughness.set([r,r,r,255],p);
        if(a<8){normal[p]=normal[p+1]=128;normal[p+2]=255;roughness[p]=roughness[p+1]=roughness[p+2]=235;}
      }
      const derived=(data,name)=>{const image=document.createElement('canvas');image.width=sizeX;image.height=sizeY;image.getContext('2d').putImageData(new ImageData(data,sizeX,sizeY),0,0);const texture=new THREE.CanvasTexture(image);texture.name=`Grass ${id} ${name}`;texture.colorSpace=THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.anisotropy=8;return texture;};
      map.name=`Grass ${id} color`;map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;map.anisotropy=8;map.userData={grassAtlas:id,grassAtlasRevision:grassAtlas.revision};
      return{map,normalMap:derived(normal,'normal'),roughnessMap:derived(roughness,'roughness')};
    }catch(error){map.dispose();throw error;}
  })().catch(error=>{grassSources.delete(id);throw new Error(`Grass card texture failed to load: ${error.message}`);}));
  return grassSources.get(id);
}

const details = new Map();
/** Stronger plant skin and petal detail; tree templates are never modified. */
export function plantDetailMaps(id, original) {
  if (details.has(id)) return details.get(id);
  const source = original.map.image;
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let mean = 0;
  for (let i = 0; i < pixels.data.length; i += 4) mean += pixels.data[i];
  mean /= pixels.data.length / 4;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = Math.max(95, Math.min(255, 202 + (pixels.data[i] - mean) * (id === 'petal' ? 3.4 : 4.5)));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const map = original.map.clone(); map.source = new THREE.Source(canvas); map.name = `${id} surface color`; map.needsUpdate = true;
  const result = { ...original, map }; details.set(id, result); return result;
}
