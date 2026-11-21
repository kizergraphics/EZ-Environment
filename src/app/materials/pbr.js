import * as THREE from 'three';
import { loadGrassCardSurface, loadLeafSurface, loadPlantDetail } from './plant-surface.js';
import { companionMaps, loadSurfaceMaps } from './surface-maps.js';
import { loadWoodMaps } from './wood-surface.js';

const barkTypes=new Set(['Bark001','Bark002','Bark003','Bark004','Bark006','Bark007','Bark008','Bark012','Bark013','Bark014','Bark015']);
const hasPbrMaps=material=>['map','normalMap','roughnessMap'].every(slot=>{
  const image=material[slot]?.image;return image?.width>0&&image?.height>0;
});
function abort(signal){if(signal?.aborted)throw signal.reason||new DOMException('Material preparation cancelled.','AbortError');}
export async function loadPbrFamily(id,{signal,variant}={}) {
  abort(signal);
  let maps;
  if (id === 'grassCards') maps = await loadGrassCardSurface(variant);
  else if (id === 'wood' || id === 'endgrain') maps = await loadWoodMaps(id);
  else if (id === 'foliage') maps = await loadLeafSurface(variant);
  else if (['stem', 'petal', 'pollen'].includes(id)) maps = await loadPlantDetail(id);
  else if (id === 'bark') {
    const type = variant ?? 'Bark004';
    if (!barkTypes.has(type)) throw new Error(`Unknown bark texture: ${type}`);
    const dir = `${type}_1K-JPG`;
    const base = `/textures/bark/${dir}/${dir}`;
    maps = await loadSurfaceMaps(type, ['_Color.jpg', '_NormalGL.jpg', '_Roughness.jpg'].map(suffix => base + suffix));
  } else if (id === 'stone' || id === 'sandstone') {
    const base = `/textures/rocks/${id}`;
    maps = await loadSurfaceMaps(id, companionMaps(`${base}-color.jpg`, base));
  } else throw new Error(`Unknown PBR material family: ${id}`);
  abort(signal);
  return maps;
}

export async function prepareAssetMaterials(asset,{signal}={}) {
  abort(signal);const materials=new Set();
  for(const root of asset.lods||[asset.object3D])root?.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.userData.pbrFamily&&!(m.userData.pbrReady&&hasPbrMaps(m)))materials.add(m);});
  const loaded=await Promise.all([...materials].map(async material=>({material,maps:await loadPbrFamily(material.userData.pbrFamily,{signal,variant:material.userData.pbrLeafTexture??material.userData.pbrVariant})})));abort(signal);
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
