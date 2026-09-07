import { BIOMES } from './biomes.js';
import { random, biomeNoise as noise } from './random.js';
import { contains, terrainHeight, terrainNormal } from './placement.js';

export function biomeTreeRecords(options) {
  if(options.composition!=='biome')return [];
  const spec=BIOMES[options.biome].trees,rng=random(options.seed^0x71bac),records=[];
  const count=Math.min(360,Math.round(Math.PI*options.radius**2*spec.density));
  for(let attempt=0;attempt<count*35&&records.length<count;attempt++){
    const angle=rng()*Math.PI*2,r=Math.sqrt(rng())*options.radius,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    if(options.biome==='meadow'&&r<options.radius*.65)continue;
    if(noise(x/25,z/25,options.seed^77)<.31||terrainNormal(x,z,options)[1]<.8)continue;
    if(options.exclusions.some(s=>contains(s,x,z,1.8)))continue;
    if(records.some(t=>Math.hypot(x-t.x,z-t.z)<spec.spacing))continue;
    records.push({x,z,y:terrainHeight(x,z,options),yaw:rng()*Math.PI*2,scale:.72+rng()*.55,variant:Math.floor(rng()*3),preset:spec.presets[records.length%spec.presets.length]});
  }
  return records;
}

export function withBiomeSources(options, records) {
  if(options.composition!=='biome')return options;
  return {...options,treeExclusions:[...options.treeExclusions.filter(s=>s.source!=='biome-tree'),...records.map(t=>({source:'biome-tree',type:'circle',x:t.x,z:t.z,radius:1.1*t.scale}))],
    canopySources:[...options.canopySources.filter(s=>s.source!=='biome-tree'),...records.map(t=>({source:'biome-tree',x:t.x,z:t.z,radius:(/Small/.test(t.preset)?4:7)*t.scale,strength:.92}))]};
}
