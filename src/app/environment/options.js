export const QUALITY = {
  low: { grass: 6000, flowers: 500, plants: 300, rocks: 100, boulders: 15, pebbles: 1200, distance: 100, shadows: false },
  medium: { grass: 14000, flowers: 1500, plants: 800, rocks: 220, boulders: 35, pebbles: 3000, distance: 160, shadows: true },
  high: { grass: 25000, flowers: 3000, plants: 1500, rocks: 300, boulders: 60, pebbles: 5000, distance: 240, shadows: true },
};
export const LAYERS = ['grass', 'flowers', 'plants', 'rocks', 'boulders', 'pebbles'];
export const DEFAULT_RULES = Object.freeze({minSlope:0,maxSlope:38,minElevation:-10000,maxElevation:10000,minMoisture:0,maxMoisture:1,minCanopy:0,maxCanopy:1});
function layer(options, maxSlope=38) {
  return {height:1,width:1,tint:1,color:'#547d31',dryness:0,speciesChoices:[],densityMap:null,canopyReduction:0,maxTilt:38,burialDepth:.025,burialVariation:.06,rules:{...DEFAULT_RULES,maxSlope},...options};
}
export const DEFAULT_OPTIONS = {
  version: 1, seed: 18427, radius: 96, chunkSize: 64, quality: 'medium', biome: 'meadow',
  composition:'legacy',biomeRevision:1,modified:false,includeAuthoredTree:true,appearance:'naturalistic',
  lighting:{sky:'#79a8c3',horizon:'#c5d6ca',fog:'#c5d6ca',fogDensity:.0022,sun:'#fff1d7',elevation:35,intensity:3,ambient:1.6,exposure:1},
  terrain: { amplitude: 0, scale: 48 }, wind: { strength: 0.22, frequency: 1.1, direction: [0.7, 0.3], gustStrength:.2, spatialScale:350 },
  layers: {
    grass: layer({ enabled: true, density: 0.50, size: 1, patchiness: 0.4, species: 'grass', minSpacing: 0.12 }),
    flowers: layer({ enabled: true, density: 0.025, size: 1, patchiness: 0.65, species: 'flower', minSpacing: 0.35 }),
    plants: layer({ enabled: true, density: 0.012, size: 1, patchiness: 0.5, species: 'shrub', minSpacing: 1.5 },32),
    rocks: layer({ enabled: true, density: 0.006, size: 1, patchiness: 0.7, species: 'rock', minSpacing: 1.8 }),
    boulders: layer({ enabled: true, density: 0.001, size: 1, patchiness: 0.4, species: 'boulder', minSpacing: 5 }),
    pebbles: layer({ enabled: true, density: 0.12, size: 1, patchiness: 0.85, species: 'pebble', minSpacing: 0.12 }),
  }, exclusions: [{ type: 'circle', x: 0, z: 0, radius: 7 }], treeExclusions:[], brushes: [], canopySources:[], customSpecies: [],
};
export function number(value, name, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number between ${min} and ${max}.`);
  return value;
}
export function validateOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Environment configuration must be an object.');
  for (const key of ['terrain', 'wind', 'layers']) if (input[key] !== undefined && (!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key]))) throw new Error(`Environment ${key} must be an object.`);
  const o = { ...structuredClone(DEFAULT_OPTIONS), ...structuredClone(input) };
  if (o.version !== 1) throw new Error('Unsupported environment version. Expected version 1.');
  number(o.seed, 'Seed', 0, 4294967295);
  if (!Number.isInteger(o.seed)) throw new Error('Seed must be an integer.');
  number(o.radius, 'Radius', 16, 256); number(o.chunkSize, 'Chunk size', 16, 96);
  if (!QUALITY[o.quality]) throw new Error('Quality must be low, medium, or high.');
  if(!['meadow','forest','desert','rocky','woodland'].includes(o.biome))throw new Error('Unknown biome.');
  if(!['legacy','biome'].includes(o.composition)||!['naturalistic','photorealistic'].includes(o.appearance))throw new Error('Unknown composition or appearance.');
  if(o.composition==='biome'&&o.biome==='woodland')o.biome='forest';
  if(typeof o.includeAuthoredTree!=='boolean'||typeof o.modified!=='boolean')throw new Error('Invalid biome flags.');
  o.lighting={...DEFAULT_OPTIONS.lighting,...o.lighting};
  for(const key of ['sky','horizon','fog','sun'])if(!/^#[0-9a-f]{6}$/i.test(o.lighting[key]))throw new Error(`Invalid lighting ${key}.`);
  for(const [key,min,max] of [['fogDensity',0,.03],['elevation',5,85],['intensity',0,8],['ambient',0,4],['exposure',.2,2]])number(o.lighting[key],`Lighting ${key}`,min,max);
  o.terrain = { ...DEFAULT_OPTIONS.terrain, ...o.terrain };
  if(o.terrain.form!==undefined&&!['rolling','dunes','ridges'].includes(o.terrain.form))throw new Error('Unknown terrain form.');
  number(o.terrain.amplitude, 'Terrain height', 0, 15); number(o.terrain.scale, 'Terrain scale', 8, 150);
  o.wind = { ...DEFAULT_OPTIONS.wind, ...o.wind };
  number(o.wind.strength, 'Wind strength', 0, 2); number(o.wind.frequency, 'Wind frequency', 0, 5);
  number(o.wind.gustStrength,'Wind gust strength',0,1);number(o.wind.spatialScale,'Wind spatial scale',1,2000);
  if (!Array.isArray(o.wind.direction) || o.wind.direction.length !== 2 || !o.wind.direction.every(Number.isFinite)) throw new Error('Wind direction requires two numbers.');
  o.layers = Object.fromEntries(LAYERS.map(id => {
    if (o.layers?.[id] !== undefined && (!o.layers[id] || typeof o.layers[id] !== 'object' || Array.isArray(o.layers[id]))) throw new Error(`Invalid ${id} layer definition.`);
    const l = { ...DEFAULT_OPTIONS.layers[id], ...o.layers?.[id] };
    if(l.rules!==undefined&&(!l.rules||typeof l.rules!=='object'||Array.isArray(l.rules)))throw new Error(`${id} rules must be an object.`);
    l.rules={...DEFAULT_OPTIONS.layers[id].rules,...l.rules};
    number(l.density, `${id} density`, 0, 2); number(l.size, `${id} size`, 0.1, 5);
    number(l.patchiness, `${id} patchiness`, 0, 1); number(l.minSpacing, `${id} spacing`, 0, 20);
    if (typeof l.enabled !== 'boolean' || typeof l.species !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(l.species)) throw new Error(`Invalid ${id} definition.`);
    number(l.height,`${id} height`,.1,5);number(l.width,`${id} width`,.1,5);number(l.tint,`${id} tint`,0,2);number(l.dryness,`${id} dryness`,0,1);
    if(typeof l.color!=='string'||!/^#[0-9a-f]{6}$/i.test(l.color))throw new Error(`${id} color must be a six-digit hex color.`);
    number(l.canopyReduction,`${id} canopy reduction`,0,1);number(l.maxTilt,`${id} maximum tilt`,0,90);number(l.burialDepth,`${id} burial depth`,0,2);number(l.burialVariation,`${id} burial variation`,0,2);
    for(const [name,min,max]of [['Slope',0,90],['Elevation',-10000,10000],['Moisture',0,1],['Canopy',0,1]]){
      number(l.rules[`min${name}`],`${id} minimum ${name}`,min,max);number(l.rules[`max${name}`],`${id} maximum ${name}`,min,max);
      if(l.rules[`min${name}`]>l.rules[`max${name}`])throw new Error(`${id} minimum ${name} cannot exceed its maximum.`);
    }
    if(!Array.isArray(l.speciesChoices)||l.speciesChoices.length>32)throw new Error(`${id} supports at most 32 weighted species choices.`);
    const choiceIDs=new Set();
    for(const choice of l.speciesChoices){
      if(!choice||typeof choice!=='object'||typeof choice.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(choice.id)||choiceIDs.has(choice.id))throw new Error(`${id} weighted species require unique safe IDs.`);
      number(choice.weight,`${id} species weight`,Number.MIN_VALUE,1000000);choiceIDs.add(choice.id);
    }
    if(l.densityMap!==null){
      const map=l.densityMap;if(!map||typeof map!=='object'||Array.isArray(map))throw new Error(`${id} density map must be an object or null.`);
      number(map.width,`${id} map width`,1,256);number(map.height,`${id} map height`,1,256);
      if(!Number.isInteger(map.width)||!Number.isInteger(map.height)||!Array.isArray(map.data)||map.data.length!==map.width*map.height)throw new Error(`${id} density map requires width × height grayscale samples.`);
      for(const value of map.data)number(value,`${id} grayscale value`,0,1);
      if(!Array.isArray(map.origin)||map.origin.length!==2||!Array.isArray(map.size)||map.size.length!==2)throw new Error(`${id} density map requires two-value origin and size arrays.`);
      for(const value of map.origin)number(value,`${id} map origin`,-10000,10000);
      for(const value of map.size)number(value,`${id} map world size`,.01,20000);
    }
    return [id, l];
  }));
  if (!Array.isArray(o.exclusions) || !Array.isArray(o.brushes) || o.exclusions.length + o.brushes.length > 2000) throw new Error('Invalid or excessive paint/exclusion records (maximum 2000).');
  if(!Array.isArray(o.treeExclusions)||o.treeExclusions.length>1000)throw new Error('At most 1000 generated tree exclusions are supported.');
  for (const s of [...o.exclusions, ...o.brushes, ...o.treeExclusions]) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Mask records must be objects.');
    if (!['circle', 'rectangle', 'polygon', 'path'].includes(s.type)) throw new Error('Unsupported exclusion shape.');
    if (s.type === 'circle') { number(s.x, 'Mask x', -10000, 10000); number(s.z, 'Mask z', -10000, 10000); number(s.radius, 'Mask radius', 0.01, 1000); }
    else if (s.type === 'rectangle') { for (const k of ['x', 'z', 'width', 'depth']) number(s[k], `Rectangle ${k}`, k === 'x' || k === 'z' ? -10000 : 0.01, 10000); }
    else if (!Array.isArray(s.points) || s.points.length < (s.type === 'polygon' ? 3 : 2) || s.points.length > 1024 || !s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new Error('Invalid polygon/path points.');
    if (s.type === 'path') number(s.width, 'Path width', 0.01, 1000);
    if (s.strength !== undefined) number(s.strength, 'Brush strength', -1, 1);
    if (s.layer !== undefined && !LAYERS.includes(s.layer)) throw new Error('Brush layer must be a supported environment layer.');
  }
  for (const brush of o.brushes) number(brush.strength, 'Brush strength', -1, 1);
  if(!Array.isArray(o.canopySources)||o.canopySources.length>2048)throw new Error('At most 2048 canopy sources are supported.');
  o.canopySources=o.canopySources.map(source=>{
    if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('Canopy sources must be objects.');
    const item={...source,strength:source.strength??1};number(item.x,'Canopy x',-10000,10000);number(item.z,'Canopy z',-10000,10000);number(item.radius,'Canopy radius',.01,1000);number(item.strength,'Canopy strength',0,1);return item;
  });
  if (!Array.isArray(o.customSpecies) || o.customSpecies.length > 32) throw new Error('At most 32 custom species are supported.');
  const ids = new Set();
  for (const species of o.customSpecies) {
    if (!species || typeof species !== 'object' || typeof species.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(species.id) || ids.has(species.id)) throw new Error('Custom species require unique safe IDs.');
    if (!species.definition || typeof species.definition !== 'object' || Array.isArray(species.definition) || typeof species.definition.archetype !== 'string') throw new Error('Custom species require an asset definition.');
    ids.add(species.id);
  }
  return o;
}
