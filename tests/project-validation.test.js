import test from 'node:test';
import assert from 'node:assert/strict';
import { Tree,TreePreset } from '../build/ez-tree.es.js';
import { validateTreeProject } from '../src/app/studio/project-validation.js';
import { BarkType, LeafType } from '../src/app/textures.js';

function dispose(tree){const geometries=new Set(),materials=new Set();tree.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
function defaults(){const tree=new Tree(),result=JSON.parse(JSON.stringify(tree.options));delete result.bark.maps;delete result.leaves.map;dispose(tree);return result;}
function finiteGeometry(tree){let vertices=0;tree.traverse(o=>{
  if(!o.geometry)return;
  for(const [name,attribute]of Object.entries(o.geometry.attributes))assert.ok(attribute.array.every(Number.isFinite),`${o.name||'Tree'} ${name} must be finite`);
  const count=o.geometry.attributes.position?.count||0;vertices+=count;
  if(o.geometry.index)assert.ok(o.geometry.index.array.every(i=>Number.isInteger(i)&&i>=0&&i<count),'Geometry indices must address valid vertices');
});assert.ok(vertices>0,'Tree must have geometry');}
function generate(input){const tree=new Tree();try{tree.options.copy(validateTreeProject(input,defaults()));tree.generate();finiteGeometry(tree);}finally{dispose(tree);}}
function patch(path,value){const parts=path.split('.'),result={};let at=result;for(const key of parts.slice(0,-1)){at[key]={};at=at[key];}at[parts.at(-1)]=value;return result;}

test('all 16 bundled presets validate and generate finite real Tree geometry without mutation',()=>{
  const baseline=defaults(),beforeDefaults=JSON.stringify(baseline);
  assert.equal(Object.keys(TreePreset).length,16);
  for(const [name,preset]of Object.entries(TreePreset)){
    const before=JSON.stringify(preset),validated=validateTreeProject(preset,baseline),tree=new Tree();
    try{tree.options.copy(validated);assert.doesNotThrow(()=>tree.generate(),name);finiteGeometry(tree);}finally{dispose(tree);}
    assert.equal(JSON.stringify(preset),before,name);assert.equal(JSON.stringify(baseline),beforeDefaults);
  }
});

test('invalid branch and leaf starts are rejected before the generator can index outside its sections',()=>{
  const baseline=defaults(),before=JSON.stringify(baseline);
  for(const path of ['branch.start.1','branch.start.2','branch.start.3','leaves.start']){
    for(const value of [-.001,1.001,2,NaN,Infinity,'0.5',null])assert.throws(()=>validateTreeProject(patch(path,value),baseline),undefined,`${path}=${value}`);
  }
  const bad=new Tree();bad.options.branch.start[1]=2;
  try{assert.throws(()=>bad.generate(),/origin/);}finally{dispose(bad);}
  assert.equal(JSON.stringify(baseline),before);
});

test('actual bark and leaf whitelists reject nonexistent and prototype keys',()=>{
  const baseline=defaults();
  for(const type of Object.values(BarkType))assert.equal(validateTreeProject({bark:{type}},baseline).bark.type,type);
  for(const type of Object.values(LeafType))assert.equal(validateTreeProject({leaves:{type}},baseline).leaves.type,type);
  for(const type of ['Bark999','Bark005','constructor','toString','../Bark001'])assert.throws(()=>validateTreeProject({bark:{type}},baseline),/Unknown/);
  for(const type of ['maple','constructor'])assert.throws(()=>validateTreeProject({leaves:{type}},baseline),/Unknown/);
});

test('all geometry-sensitive scalar fields enforce UI bounds and scalar types',()=>{
  const baseline=defaults(),badValues={
    'seed':[-1,4294967296,.2], 'branch.levels':[-1,4,1.5],
    'branch.force.direction.x':[-1.01,1.01], 'branch.force.direction.y':[-1.01,1.01], 'branch.force.direction.z':[-1.01,1.01], 'branch.force.strength':[-.101,.101],
    'bark.textureScale.x':[0,10.01], 'bark.textureScale.y':[0,10.01], 'bark.tint':[-1,0x1000000,.5],
    'leaves.angle':[-1,101], 'leaves.count':[-1,101,.5], 'leaves.size':[-.01,10.01], 'leaves.sizeVariance':[-.01,1.01], 'leaves.alphaTest':[-.01,1.01], 'leaves.tint':[-1,0x1000000,.5],
    'trellis.spacing':[0,.49,10.01], 'trellis.width':[0,50.01], 'trellis.height':[0,50.01],
    'trellis.position.x':[-20.01,20.01], 'trellis.position.y':[-10.01,10.01], 'trellis.position.z':[-20.01,20.01],
    'trellis.force.strength':[-.01,.201], 'trellis.force.maxDistance':[0,20.01], 'trellis.force.falloff':[0,3.01], 'trellis.cylinderRadius':[0,.501], 'trellis.color':[-1,0x1000000,.5],
  };
  for(let i=0;i<4;i++){
    badValues[`branch.length.${i}`]=[0,100.01];badValues[`branch.radius.${i}`]=[0,5.01];badValues[`branch.sections.${i}`]=[0,21,1.5];badValues[`branch.segments.${i}`]=[2,17,3.5];
    badValues[`branch.gnarliness.${i}`]=[-.501,.501];badValues[`branch.taper.${i}`]=[-.01,1.01];badValues[`branch.twist.${i}`]=[-.501,.501];
    if(i<3)badValues[`branch.children.${i}`]=[-1,[101,11,6][i],.5];
    if(i>0)badValues[`branch.angle.${i}`]=[-1,181];
  }
  for(const [path,values]of Object.entries(badValues))for(const value of [...values,NaN,Infinity,'1',null])assert.throws(()=>validateTreeProject(patch(path,value),baseline),undefined,`${path}=${value}`);
  for(const input of [{branch:null},{branch:[]},{trellis:{force:3}},{leaves:{roundedNormals:'yes'}},{bark:{textured:1}},{trellis:{enabled:0}},{type:'unknown'}])assert.throws(()=>validateTreeProject(input,baseline));
});

test('unsafe zero-radius endpoint combinations reject while usable UI endpoints generate',()=>{
  const baseline=defaults();
  for(const input of [{type:'evergreen',branch:{levels:1,start:{1:1}}},{branch:{taper:{0:1}}},{branch:{taper:{1:1}}},{branch:{taper:{2:1}}}])assert.throws(()=>validateTreeProject(input,baseline),/below 1/);
  // Exact start endpoints are safe on a non-zero deciduous section, and the
  // final branch level can taper fully because it has no continuation.
  generate({branch:{levels:1,start:{1:1},taper:{1:1}},leaves:{start:1}});
  generate({branch:{levels:0,taper:{0:1}},leaves:{count:0,size:0}});
  generate({type:'evergreen',branch:{levels:1,start:{1:.999}},leaves:{start:1}});
});

test('partial trees inherit detached defaults and never accept serialized texture objects',()=>{
  const baseline=defaults(),source={branch:{start:{1:.2}},bark:{maps:{color:{url:'https://invalid.test/texture'}}},leaves:{map:{image:'malformed'}}};
  const before=JSON.stringify(source),result=validateTreeProject(source,baseline);
  assert.equal(result.branch.start[1],.2);assert.equal(result.branch.start[2],baseline.branch.start[2]);assert.equal(result.bark.maps,undefined);assert.equal(result.leaves.map,undefined);
  result.branch.start[2]=.8;assert.notEqual(result.branch.start[2],baseline.branch.start[2]);assert.equal(JSON.stringify(source),before);
});
