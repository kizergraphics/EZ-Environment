import { Tree } from 'ez-environment';
import { applyTreeTextures } from '../textures.js';
import { disposeObject } from '../environment/assets.js';
import { validateTreeProject } from './project-validation.js';

export function cleanTreeDefinition(tree) {
  const o=tree.options;
  return JSON.parse(JSON.stringify({...o,bark:{...o.bark,maps:undefined},leaves:{...o.leaves,map:undefined,normalMap:undefined,roughnessMap:undefined},trellis:{...o.trellis,maps:undefined,endMaps:undefined}}));
}

export function prepareTreeProject(input,currentTree) {
  const definition=validateTreeProject(input,cleanTreeDefinition(currentTree)),prepared=new Tree();
  try{
    prepared.options.copy(definition);applyTreeTextures(prepared);prepared.generate();
    prepared.traverse(o=>{if(o.geometry){for(const attribute of Object.values(o.geometry.attributes))for(const value of attribute.array)if(!Number.isFinite(value))throw new Error('Tree settings produced invalid geometry. Reduce branch taper or start values.');}});
    return prepared;
  }
  catch(error){disposeObject(prepared);throw error;}
}

// Preserve the live Tree instance and its transform: the existing UI and render
// loop retain that identity. Only transfer an already-generated, validated tree.
export function commitTreeProject(target,prepared) {
  disposeObject(target);target.clear();
  for(const key of ['options','rng','branchQueue','branches','leaves','skeleton','branchesMesh','leavesMesh','trellisMesh','lod'])target[key]=prepared[key];
  target.add(...prepared.children);
}
