import { BarkType, LeafType } from '../textures.js';

// Validate serialized tree settings before changing any live workspace state.
// Texture objects are never accepted from project JSON; the app resolves them.
export function validateTreeProject(input, defaults) {
  const result=structuredClone(defaults);
  function merge(source,target,path='tree'){
    if(!source||typeof source!=='object'||Array.isArray(source))throw new Error(`${path} must be an object.`);
    for(const key of Object.keys(target)){
      if(['map','maps','normalMap','roughnessMap'].includes(key)||!Object.hasOwn(source,key))continue;
      const value=source[key],expected=target[key],name=`${path}.${key}`;
      if(expected&&typeof expected==='object')merge(value,expected,name);
      else{
        if(typeof value!==typeof expected||(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>4294967295)))throw new Error(`Invalid ${name}.`);
        if(typeof value==='string'&&value.length>80)throw new Error(`Invalid ${name}.`);
        target[key]=value;
      }
    }
  }
  merge(input,result);
  delete result.bark.maps;delete result.leaves.map;delete result.leaves.normalMap;delete result.leaves.roughnessMap;delete result.trellis.maps;
  function range(value,name,min,max,integer=false){if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new Error(`${name} must be between ${min} and ${max}${integer?' (integer)':''}.`);}
  range(result.seed,'Tree seed',0,4294967295,true);
  range(result.branch.levels,'Tree branch levels',0,3,true);
  for(let i=0;i<4;i++){
    if(i<3)range(result.branch.children[i],`Tree children ${i}`,0,[100,10,5][i],true);
    range(result.branch.sections[i],`Tree sections ${i}`,1,20,true);
    range(result.branch.segments[i],`Tree segments ${i}`,3,16,true);
    range(result.branch.length[i],`Tree length ${i}`,.1,100);
    range(result.branch.radius[i],`Tree radius ${i}`,.1,5);
    range(result.branch.gnarliness[i],`Tree gnarliness ${i}`,-.5,.5);
    range(result.branch.taper[i],`Tree taper ${i}`,0,1);
    range(result.branch.twist[i],`Tree twist ${i}`,-.5,.5);
    if(i>0){
      range(result.branch.angle[i],`Tree branch angle ${i}`,0,180);
      range(result.branch.start[i],`Tree branch start ${i}`,0,1);
      // Evergreens taper to zero at the tip. Spawning another branch exactly
      // there gives the generator a zero base radius and non-finite geometry.
      if(result.type==='evergreen'&&i<=result.branch.levels&&result.branch.children[i-1]>0&&result.branch.start[i]===1)throw new Error(`Tree branch start ${i} must be below 1 for an active evergreen branch.`);
    }
    // Deciduous trees always grow a terminal continuation, even with no side
    // children. Its base radius must remain nonzero until the final level.
    if(result.type==='deciduous'&&i<result.branch.levels&&result.branch.taper[i]===1)throw new Error(`Tree taper ${i} must be below 1 before the final branch level.`);
  }
  for(const axis of ['x','y','z'])range(result.branch.force.direction[axis],`Tree force direction ${axis}`,-1,1);
  range(result.branch.force.strength,'Tree force strength',-.1,.1);
  // Some original bundled presets use Y scales of 8 and 10; preserve those
  // valid authored values although the current texture slider ends at 5.
  range(result.bark.textureScale.x,'Bark texture scale X',.5,10);range(result.bark.textureScale.y,'Bark texture scale Y',.5,10);
  range(result.leaves.angle,'Leaf angle',0,100);range(result.leaves.start,'Leaf start',0,1);
  range(result.leaves.count,'Leaf count',0,100,true);range(result.leaves.size,'Leaf size',0,10);
  range(result.leaves.sizeVariance,'Leaf size variance',0,1);range(result.leaves.alphaTest,'Leaf alpha test',0,1);
  range(result.trellis.spacing,'Trellis spacing',.5,10);range(result.trellis.width,'Trellis width',1,50);range(result.trellis.height,'Trellis height',1,50);
  range(result.trellis.position.x,'Trellis position X',-20,20);range(result.trellis.position.y,'Trellis position Y',-10,10);range(result.trellis.position.z,'Trellis position Z',-20,20);
  range(result.trellis.force.strength,'Trellis force strength',0,.2);range(result.trellis.force.maxDistance,'Trellis force distance',.5,20);range(result.trellis.force.falloff,'Trellis force falloff',.1,3);
  range(result.trellis.cylinderRadius,'Trellis cylinder radius',.01,.5);
  for(const [name,value]of [['Bark tint',result.bark.tint],['Leaf tint',result.leaves.tint],['Trellis color',result.trellis.color]])range(value,name,0,0xffffff,true);
  if(!['deciduous','evergreen'].includes(result.type)||!['single','double'].includes(result.leaves.billboard)||!Object.values(LeafType).includes(result.leaves.type)||!Object.hasOwn(BarkType,result.bark.type))throw new Error('Unknown tree type, leaf, or bark preset.');
  return result;
}
