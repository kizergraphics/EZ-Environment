import { DEFAULT_OPTIONS, validateOptions } from './options.js';

// Presets are complete compositions. Applying one never merges the previous biome's layers.
const catalog = {
  forest: { name:'Forest', subtitle:'Canopy · moss · shaded clearings', surface:['leaf-litter','moss-soil'], colors:['#696044','#41513a'], terrain:{form:'rolling',amplitude:5,scale:48}, trees:{density:.010,spacing:7,presets:['Oak Medium','Ash Medium','Oak Small']}, lighting:{sky:'#789baa',horizon:'#b6c6bb',fog:'#b6c6bb',fogDensity:.004,sun:'#fff0ce',elevation:38,intensity:2.7,ambient:1.3,exposure:1}, wind:.16,
    layers:{grass:{density:.42,size:1.2,color:'#62713c',canopyReduction:.85},flowers:{density:.004,species:'flower_white'},plants:{density:.065,size:1.35,species:'fern',speciesChoices:[{id:'fern',weight:6},{id:'shrub',weight:2},{id:'fallen_log',weight:.25}],patchiness:.8},rocks:{density:.003,size:1.25},boulders:{density:.0006,size:1.5},pebbles:{density:.035}} },
  desert: { name:'Desert', subtitle:'Wind-shaped dunes · sandstone · arid plants', surface:['dune-sand','desert-gravel'], colors:['#d2b681','#a4916e'], terrain:{form:'dunes',amplitude:9,scale:55},trees:{density:0,spacing:10,presets:[]}, lighting:{sky:'#80a7bb',horizon:'#e1ceb0',fog:'#e1ceb0',fogDensity:.0027,sun:'#fff0cd',elevation:42,intensity:3.4,ambient:1.5,exposure:1.05},wind:.42,
    layers:{grass:{density:.018,species:'grass_clump',size:.85,color:'#a19361',dryness:.95,patchiness:.9},flowers:{enabled:false,density:0},plants:{density:.006,size:1.6,species:'dry_shrub',speciesChoices:[{id:'dry_shrub',weight:5},{id:'cactus',weight:2}],patchiness:.9},rocks:{density:.003,size:1.7,species:'sandstone',burialDepth:.14},boulders:{density:.0008,size:2,species:'sandstone_outcrop',minSpacing:10,burialDepth:.25},pebbles:{density:.035,species:'desert_pebble'}} },
  meadow: { name:'Meadow', subtitle:'Rolling grassland · wildflowers · open sky', surface:['meadow-soil','dry-earth'], colors:['#687247','#8d805c'],terrain:{form:'rolling',amplitude:3.5,scale:65},trees:{density:.0006,spacing:15,presets:['Ash Medium','Oak Small']},lighting:{sky:'#79a8c3',horizon:'#c5d6ca',fog:'#c5d6ca',fogDensity:.0022,sun:'#fff1d7',elevation:35,intensity:3,ambient:1.6,exposure:1},wind:.28,
    layers:{grass:{density:1.5,size:1.5,species:'grass',color:'#738347',patchiness:.28},flowers:{density:.08,size:1.1,species:'flower_white',speciesChoices:[{id:'flower_white',weight:4},{id:'flower_yellow',weight:3},{id:'flower_blue',weight:1}],patchiness:.8},plants:{density:.007,species:'bush',size:1.2},rocks:{density:.0012},boulders:{density:.00015},pebbles:{density:.014}} },
  rocky: { name:'Rocky', subtitle:'Weathered outcrops · scree · hardy grasses',surface:['weathered-rock','dry-earth'],colors:['#8a8980','#7e795f'],terrain:{form:'ridges',amplitude:12,scale:40},trees:{density:.0009,spacing:15,presets:['Pine Medium','Pine Small']},lighting:{sky:'#8196a4',horizon:'#c0c8c9',fog:'#c0c8c9',fogDensity:.0032,sun:'#e9edee',elevation:30,intensity:2.6,ambient:1.6,exposure:1},wind:.35,
    layers:{grass:{density:.13,species:'grass_clump',size:1.1,color:'#7c8257',dryness:.4,patchiness:.85},flowers:{density:.002},plants:{density:.009,species:'dry_shrub',size:.85},rocks:{density:.018,size:1.9,patchiness:.9},boulders:{density:.0025,size:3,species:'rock_outcrop',minSpacing:8},pebbles:{density:.2,size:1.4,patchiness:.85}} },
};

const mixes={
  forest:{plants:[['fern',6],['berry-thicket',1],['wood-sorrel',1],['moss-cushion',1],['young-pine',.2],['fallen-log',.25]],boulders:[['boulder',1],['mossy-forest-boulder',3]]},
  meadow:{grass:[['grass',7],['short-meadow-grass',2],['tall-seed-grass',1]],plants:[['bush',2],['clover-groundcover',5]],rocks:[['rock',1],['low-fieldstone',3]],boulders:[['boulder',1],['glacial-erratic',3]]},
  desert:{grass:[['grass_clump',1],['dry-bunchgrass',3]],plants:[['sagebrush',5],['saguaro-cactus',1],['agave-rosette',2]],rocks:[['sandstone',3],['red-sandstone-slab',1]],boulders:[['sandstone_outcrop',1],['sandstone-outcrop',3]],pebbles:[['desert_pebble',1],['desert-gravel',3]]},
  rocky:{grass:[['grass_clump',1],['alpine-grass-tuft',3]],plants:[['dry_shrub',1],['heather-cushion',3]],rocks:[['rock',4],['basalt-chunk',2],['limestone-slab',1],['talus-scree',.4],['standing-stone',.15]],boulders:[['rock_outcrop',3],['granite-outcrop',2],['volcanic-boulder',1]]},
};
for(const [biome,layers]of Object.entries(mixes))for(const [layer,entries]of Object.entries(layers)){
  const target=catalog[biome].layers[layer];
  target.speciesChoices=entries.map(([id,weight])=>({id,weight}));
  if(!entries.some(([id])=>id===target.species))target.species=entries[0][0];
}
export const BIOMES=Object.freeze(catalog);

export function applyBiome(current, id) {
  const biome=BIOMES[id];if(!biome)throw new Error('Unknown biome.');
  const layers=structuredClone(DEFAULT_OPTIONS.layers);
  for(const key of Object.keys(layers))layers[key]={...layers[key],...biome.layers[key],densityMap:current.layers?.[key]?.densityMap??null};
  return validateOptions({...current,biome:id,composition:'biome',biomeRevision:2,modified:false,includeAuthoredTree:false,
    terrain:{...biome.terrain},lighting:{...biome.lighting},wind:{...DEFAULT_OPTIONS.wind,strength:biome.wind},layers,
    treeExclusions:[],canopySources:[],exclusions:current.composition==='legacy'?(current.exclusions||[]).filter(s=>!(s.type==='circle'&&s.x===0&&s.z===0&&s.radius===7)):current.exclusions||[]});
}
