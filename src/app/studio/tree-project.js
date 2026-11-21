import { Tree } from 'ez-environment';
import { applyTreeTextures } from '../textures.js';
import { disposeObject } from '../environment/assets.js';
import { validateTreeProject } from './project-validation.js';
import { triangleCount, validateTriangleTargets } from '../generators/triangle-targets.js';
import { validateTreeHeight } from '../generators/tree-height.js';

export function cleanTreeDefinition(tree) {
  const o=tree.options;
  return JSON.parse(JSON.stringify({...o,targetHeight:tree.targetHeight,triangleTargets:tree.triangleTargets,bark:{...o.bark,maps:undefined},leaves:{...o.leaves,map:undefined,normalMap:undefined,roughnessMap:undefined},trellis:{...o.trellis,maps:undefined,endMaps:undefined}}));
}

export function prepareTreeProject(input,currentTree) {
  const defaults=cleanTreeDefinition(currentTree);
  delete defaults.triangleTargets;
  delete defaults.targetHeight;
  const definition=validateTreeProject(input,defaults),triangleTargets=validateTriangleTargets(input.triangleTargets),prepared=new Tree();
  try{
    prepared.options.copy(definition);
    prepared.targetHeight=validateTreeHeight(input.targetHeight);
    prepared.triangleTargets=triangleTargets;
    applyTreeTextures(prepared);prepared.generate();
    const minimum=1+Number(prepared.leavesMesh.geometry.index.count>0)+(prepared.trellisMesh?triangleCount(prepared.trellisMesh):0);
    const invalidLevel=triangleTargets?.findIndex(target=>target!==null&&target<minimum)??-1;
    if(invalidLevel>=0)throw new Error(`LOD ${invalidLevel} needs at least ${minimum} triangles to retain its mesh parts.`);
    prepared.traverse(o=>{if(o.geometry){for(const attribute of Object.values(o.geometry.attributes))for(const value of attribute.array)if(!Number.isFinite(value))throw new Error('Tree settings produced invalid geometry. Reduce branch taper or start values.');}});
    return prepared;
  }
  catch(error){disposeObject(prepared);throw error;}
}

// Preserve the live Tree instance and its transform: the existing UI and render
// loop retain that identity. Only transfer an already-generated, validated tree.
export function commitTreeProject(target,prepared) {
  disposeObject(target);target.clear();
  for(const key of ['options','rng','branchQueue','branches','leaves','skeleton','branchesMesh','leavesMesh','trellisMesh','lod','triangleTargets','targetHeight'])target[key]=prepared[key];
  target.add(...prepared.children);
}
