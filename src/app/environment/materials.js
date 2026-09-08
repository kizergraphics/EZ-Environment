import * as THREE from 'three';
import { BIOMES } from './biomes.js';
import { bakeTerrainTile,terrainSources } from './terrain-bake.js';
export { disposeTerrainGround } from './terrain-bake.js';

export class BiomeMaterials {
  constructor(){this.cache=new Map();this.loader=typeof document==='undefined'?null:new THREE.TextureLoader();}
  async surface(id,size){
    const key=`${id}/${size}`;if(this.cache.has(key))return this.cache.get(key);
    if(!this.loader)return null;
    const promise=(async()=>{
      const textures=[];
      try{
        for(const kind of ['color','normal','roughness']){
          const texture=await this.loader.loadAsync(`/textures/biomes/${id}/${kind}-${size}.${kind==='color'?'jpg':'png'}`);
          texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;
          if(kind==='color')texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
        }
        return {color:textures[0],normal:textures[1],roughness:textures[2]};
      }catch(error){textures.forEach(t=>t.dispose());this.cache.delete(key);throw new Error(`Could not load ${id} material. ${error.message}`);}
    })();this.cache.set(key,promise);return promise;
  }
  async prepare(options){
    const size=options.appearance==='photorealistic'&&options.quality!=='low'?2048:1024;
    const surfaces=options.composition==='biome'?BIOMES[options.biome].surface:['meadow-soil','dry-earth'];
    const [first,second,stone]=await Promise.all([...surfaces,options.biome==='desert'?'sandstone':'weathered-rock'].map(id=>this.surface(id,size)));
    return {first,second,stone};
  }
  ground(options,maps,geometry){
    const create=(surface,owned=false)=>{
      const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0});
      material.name='Terrain PBR';
      if(surface){material.map=surface.color;material.normalMap=surface.normal;material.roughnessMap=surface.roughness;}
      material.normalScale.setScalar(options.appearance==='photorealistic'?.7:.3);
      material.userData.ownedTerrainTextures=owned;
      return material;
    };
    // CPU-only geometry consumers do not create GPU textures.
    if(!maps?.first){
      if(this.loader)throw new Error('Terrain PBR textures are not ready.');
      return Array.from({length:5},()=>create(null));
    }
    const tiles=geometry?.userData.terrainTiles;
    if(!tiles?.length)throw new Error('Terrain geometry is missing its PBR tile layout.');
    const sources=terrainSources(maps,options,tiles[0],1024,['color','roughness']),materials=[];
    // Keep full source relief in a portable TEXCOORD_1 normal map. Baking all
    // normal detail into a world atlas would erase fine relief at large radii.
    const normal=maps.first.normal.clone();normal.channel=1;
    try{
      for(const tile of tiles)materials.push(create({...bakeTerrainTile(options,tile,sources,1024,['color','roughness']),normal},true));
      materials.push(create(maps.first));
      return materials;
    }catch(error){
      normal.dispose();
      for(const material of materials){for(const key of ['map','normalMap','roughnessMap'])material[key]?.dispose();material.dispose();}
      throw new Error(`Could not bake terrain PBR materials. ${error.message}`);
    }
  }
  dispose(){for(const p of this.cache.values())p.then(m=>m&&Object.values(m).forEach(t=>t.dispose())).catch(()=>{});this.cache.clear();}
}
