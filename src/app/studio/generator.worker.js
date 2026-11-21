import { generatePlant } from '../generators/plants.js';
import { generateRock } from '../generators/rocks.js';
import { applyAssetTriangleTargets, triangleSimplifierReady } from '../generators/triangle-targets.js';
self.onmessage=async ({data})=>{
  let asset;
  try{
    const t=performance.now();
    asset=(data.mode==='plant'?generatePlant:generateRock)(data.definition,{quality:data.quality||'export'});
    if(asset.definition.triangleTargets){
      await triangleSimplifierReady;
      asset=applyAssetTriangleTargets(asset,{keepEditorSource:asset.definition.grassRepresentation==='cards'});
    }
    const buffers=[];
    const serialize=l=>{
      l.updateMatrixWorld(true);
      const json=l.toJSON();
      for(const geometry of json.geometries||[]){
        const attrs=Object.values(geometry.data?.attributes||{});
        if(geometry.data?.index)attrs.push(geometry.data.index);
        for(const a of attrs){const typed=new globalThis[a.type](a.array);a.array=typed;buffers.push(typed.buffer);}
      }
      return json;
    };
    const lods=asset.lods.map(serialize),editorObject=asset.editorObject?serialize(asset.editorObject):undefined;
    self.postMessage({id:data.id,lods,editorObject,definition:asset.definition,definitionHash:asset.definitionHash,collider:asset.collider,placement:asset.placement,ms:performance.now()-t},buffers);
  }catch(e){self.postMessage({id:data.id,error:e.message});}
  finally{asset?.dispose();}
};
