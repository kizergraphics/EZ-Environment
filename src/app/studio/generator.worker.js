import { generatePlant } from '../generators/plants.js';
import { generateRock } from '../generators/rocks.js';
self.onmessage=({data})=>{
  try{
    const t=performance.now(),asset=(data.mode==='plant'?generatePlant:generateRock)(data.definition,{quality:data.quality||'export'});
    const buffers=[];
    const lods=asset.lods.map(l=>{
      l.updateMatrixWorld(true);
      const json=l.toJSON();
      for(const geometry of json.geometries||[]){
        const attrs=Object.values(geometry.data?.attributes||{});
        if(geometry.data?.index)attrs.push(geometry.data.index);
        for(const a of attrs){const typed=new globalThis[a.type](a.array);a.array=typed;buffers.push(typed.buffer);}
      }
      return json;
    });
    self.postMessage({id:data.id,lods,definition:asset.definition,definitionHash:asset.definitionHash,collider:asset.collider,placement:asset.placement,ms:performance.now()-t},buffers);
    asset.dispose();
  }catch(e){self.postMessage({id:data.id,error:e.message});}
};
