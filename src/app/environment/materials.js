import * as THREE from 'three';
import { BIOMES } from './biomes.js';

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
    if(options.composition!=='biome')return null;
    const size=options.appearance==='photorealistic'&&options.quality!=='low'?2048:1024;
    const [first,second,stone]=await Promise.all([...BIOMES[options.biome].surface,options.biome==='desert'?'sandstone':'weathered-rock'].map(id=>this.surface(id,size)));
    return {first,second,stone};
  }
  ground(options,maps){
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
    if(!maps?.first)return material;
    material.map=maps.first.color;material.normalMap=maps.first.normal;material.roughnessMap=maps.first.roughness;
    material.normalScale.setScalar(options.appearance==='photorealistic'?.7:.3);
    material.userData.viewportEffect='Biome surface blending; GLB uses the primary PBR texture and vertex color.';
    material.onBeforeCompile=shader=>{
      shader.uniforms.ezGroundSecond={value:maps.second.color};
      shader.vertexShader='attribute float biomeBlend; varying float vBiomeBlend;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBiomeBlend=biomeBlend;');
      shader.fragmentShader='uniform sampler2D ezGroundSecond; varying float vBiomeBlend;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec4 primary=texture2D(map,vMapUv);vec4 secondary=texture2D(ezGroundSecond,vMapUv*.83);diffuseColor*=mix(primary,secondary,clamp(vBiomeBlend,0.0,1.0));`);
    };
    material.customProgramCacheKey=()=> 'ez-biome-ground-v1';
    return material;
  }
  dispose(){for(const p of this.cache.values())p.then(m=>m&&Object.values(m).forEach(t=>t.dispose())).catch(()=>{});this.cache.clear();}
}
