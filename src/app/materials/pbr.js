import * as THREE from 'three';
import { loadGrassCardSurface, loadLeafSurface, plantDetailMaps } from './plant-surface.js';
import { improveRockMaps } from './rock-surface.js';
import { loadWoodMaps } from './wood-surface.js';

const botanical = new Map();
/** Original analytic microstructure, not measured scans. Cached templates must not be disposed. */
export function getBotanicalMaps(id = 'foliage') {
  if (botanical.has(id)) return botanical.get(id);
  if (!['foliage','stem','petal','pollen'].includes(id)) throw new Error(`Unknown botanical material: ${id}`);
  const size=512, height=new Float32Array(size*size), color=new Uint8Array(size*size*4), normal=color.slice(), rough=color.slice(), tau=Math.PI*2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,i=y*size+x,grain=Math.sin(tau*(u*61+v*17))*Math.sin(tau*(v*53-u*7));
    // Periodic domain warping keeps tiles seamless while breaking machine-like
    // straight veins. Broad mottling and fine pores operate at different scales.
    const warp=.018*Math.sin(tau*v*3)+.007*Math.sin(tau*(u*5+v*2));
    const mottling=Math.sin(tau*(u*3+v*2)+.6*Math.sin(tau*v*5))*Math.sin(tau*(v*4-u));
    const rib=Math.exp(-Math.pow(Math.sin(tau*(u+warp))*11,2)),veins=Math.pow(.5+.5*Math.cos(tau*(v*12-Math.abs(u-.5)*9+warp*6)),18);
    height[i]=(id==='pollen'?.5+.25*Math.sin(tau*u*21)*Math.sin(tau*v*21):id==='stem'?.45+.17*Math.sin(tau*(u*17+warp*4))+grain*.025:id==='petal'?.5+.09*Math.sin(tau*(u*19+Math.sin(tau*v)*.4))+grain*.015:.4+rib*.15+veins*.06+grain*.018)+mottling*.025;
    const shade=Math.max(175,Math.min(255,236+(height[i]-.5)*65+mottling*9)),r=Math.max(0,Math.min(255,(id==='petal'?202:id==='foliage'?218:235)+grain*7+mottling*10-height[i]*8));
    color.set([shade,Math.min(255,shade+(id==='foliage'?2:0)),Math.max(0,shade-2),255],i*4);rough.set([r,r,r,255],i*4);
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(height[y*size+(x+1)%size]-height[y*size+(x+size-1)%size])*2,dy=(height[((y+1)%size)*size+x]-height[((y+size-1)%size)*size+x])*2,length=Math.hypot(dx,dy,1);
    normal.set([Math.round((-.5*dx/length+.5)*255),Math.round((-.5*dy/length+.5)*255),Math.round((.5/length+.5)*255),255],(y*size+x)*4);
  }
  const texture=(data,srgb=false)=>{
    // GLTFExporter combines roughness with metalness through drawImage, which
    // requires a drawable browser image even though the renderer accepts raw data.
    let t;
    if(typeof document!=='undefined'){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d'),pixels=context.createImageData(size,size);
      pixels.data.set(data);context.putImageData(pixels,0,0);t=new THREE.CanvasTexture(canvas);t.flipY=false;
    }else t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
    t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
  };
  const maps={map:texture(color,true),normalMap:texture(normal),roughnessMap:texture(rough)};
  for(const [slot,t]of Object.entries(maps))t.name=`${id}-${slot}-original`;
  botanical.set(id,maps);return maps;
}

const families=new Map();
const barkTypes=new Set(['Bark001','Bark002','Bark003','Bark004','Bark006','Bark007','Bark008','Bark012','Bark013','Bark014','Bark015']);
const hasPbrMaps=material=>['map','normalMap','roughnessMap'].every(slot=>{
  const image=material[slot]?.image;return image?.width>0&&image?.height>0;
});
function abort(signal){if(signal?.aborted)throw signal.reason||new DOMException('Material preparation cancelled.','AbortError');}
export async function loadPbrFamily(id,{signal,variant}={}) {
  abort(signal);
  if(id==='grassCards')return typeof document==='undefined'?getBotanicalMaps('foliage'):loadGrassCardSurface(variant);
  if(['wood','endgrain'].includes(id))return loadWoodMaps(id);
  if(['foliage','stem','petal','pollen'].includes(id)) {
    if (typeof document === 'undefined') return getBotanicalMaps(id);
    return id === 'foliage' ? loadLeafSurface(variant) : plantDetailMaps(id, getBotanicalMaps(id));
  }
  if(!['bark','stone','sandstone'].includes(id))throw new Error(`Unknown PBR material family: ${id}`);
  const barkType=id==='bark'?(variant??'Bark004'):undefined;
  if(id==='bark'&&!barkTypes.has(barkType))throw new Error(`Unknown bark texture: ${barkType}`);
  // Headless contexts cannot decode the bundled photographs; the analytic stem
  // detail keeps bark materials usable for DOM-free generation and tests.
  if (typeof document === 'undefined' && id === 'bark') return getBotanicalMaps('stem');
  const cacheKey=id==='bark'?`${id}:${barkType}`:id;
  if(!families.has(cacheKey))families.set(cacheKey,(async()=>{
    const base=id==='bark'?`/textures/bark/${barkType}_1K-JPG/${barkType}_1K-JPG`:`/textures/biomes/${id==='stone'?'weathered-rock':'sandstone'}`;
    const paths=id==='bark'?['_Color.jpg','_NormalGL.jpg','_Roughness.jpg']:['/color-2048.jpg','/normal-2048.png','/roughness-2048.png'];
    const loader=new THREE.TextureLoader(),settled=await Promise.allSettled(paths.map(path=>loader.loadAsync(base+path)));
    if(settled.some(r=>r.status==='rejected')){settled.forEach(r=>{if(r.status==='fulfilled')r.value.dispose();});throw new Error(`Could not load ${id} PBR textures. Retry generation.`);}
    const [map,normalMap,roughnessMap]=settled.map(r=>r.value);
    if(id!=='bark')return improveRockMaps(id,{map,normalMap,roughnessMap});
    // Preserve the photographed bark's color and fissure contrast. A neutral
    // material tint shows the selected species surface without a brown wash.
    map.colorSpace=THREE.SRGBColorSpace;
    for(const t of [map,normalMap,roughnessMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;t.needsUpdate=true;}
    return {map,normalMap,roughnessMap};
  })().catch(error=>{families.delete(cacheKey);throw error;}));
  const maps=await families.get(cacheKey);abort(signal);return maps;
}

export async function prepareAssetMaterials(asset,{signal}={}) {
  abort(signal);const materials=new Set();
  for(const root of asset.lods||[asset.object3D])root?.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.userData.pbrFamily&&!(m.userData.pbrReady&&hasPbrMaps(m)))materials.add(m);});
  const loaded=await Promise.all([...materials].map(async material=>({material,maps:material.userData.pbrPreserveColorMap && ['foliage','petal'].includes(material.userData.pbrFamily) ? getBotanicalMaps(material.userData.pbrFamily) : await loadPbrFamily(material.userData.pbrFamily,{signal,variant:material.userData.pbrLeafTexture??material.userData.pbrVariant})})));abort(signal);
  for(const {material,maps}of loaded){
    if(material.userData.pbrReady&&hasPbrMaps(material))continue;
    // Separately parsed worker LODs can share the same structured-cloned metadata
    // object while owning different materials. Readiness belongs to each material.
    material.userData={...material.userData};
    if(['foliage','grassCards'].includes(material.userData.pbrFamily)&&material.userData.pbrBaselineTint){
      const baseline=new THREE.Color(material.userData.pbrBaselineTint);
      material.color.setRGB(Math.min(1,material.color.r/Math.max(.0001,baseline.r)),Math.min(1,material.color.g/Math.max(.0001,baseline.g)),Math.min(1,material.color.b/Math.max(.0001,baseline.b)));
    }
    const owned=[];
    for(const [slot,source]of Object.entries(maps)){
      if(slot==='map'&&material.map&&material.userData.pbrPreserveColorMap)continue;
      const texture=source.clone();texture.repeat.setScalar(material.userData.pbrTextureScale||1);texture.needsUpdate=true;material[slot]=texture;owned.push(texture);
    }
    material.metalness=0;material.normalScale.setScalar(material.userData.pbrNormalScale ?? (material.userData.pbrFamily==='grassCards'?.28:material.userData.pbrFamily==='foliage'?.65:material.userData.pbrFamily==='bark'?.8:material.userData.pbrFamily==='stone'?.75:.5));material.userData.pbrReady=true;material.needsUpdate=true;
    const dispose=()=>{owned.forEach(t=>t.dispose());material.removeEventListener('dispose',dispose);};material.addEventListener('dispose',dispose);
  }
  return asset;
}

export function assertPbrReady(root, { requireAll = false } = {}) {
  root?.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(!o.isMesh || !o.geometry?.attributes.position?.count)continue;
    if(!requireAll && !m?.userData.pbrFamily)continue;
    if(!m || !m.isMeshStandardMaterial)throw new Error(`Surface "${o.name || 'mesh'}" requires a standard PBR material.`);
    for(const slot of ['map','normalMap','roughnessMap']){const image=m[slot]?.image;if(!image||!(image.width>0&&image.height>0))throw new Error(`PBR material "${m.name||m.userData.pbrFamily}" is missing ${slot}. Regenerate or retry texture loading before export.`);}
    if(requireAll)for(const slot of ['map','normalMap','roughnessMap']){
      const channel=m[slot].channel??0,key=channel===0?'uv':`uv${channel}`,uv=o.geometry.attributes[key];
      if(!uv || uv.count!==o.geometry.attributes.position.count)throw new Error(`PBR surface "${o.name || m.name}" is missing ${key} coordinates for ${slot}.`);
    }
  }});return true;
}
