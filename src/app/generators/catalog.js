import { PLANT_PRESETS, PLANT_ARCHETYPES } from './plants.js';
import { ROCK_PRESETS, ROCK_ARCHETYPES } from './rocks.js';

export const ASSET_PRESETS=Object.freeze([...PLANT_PRESETS,...ROCK_PRESETS]);
export const MEADOW_ASSET_PRESETS = Object.freeze(ASSET_PRESETS.filter(
  preset => preset.group === 'Meadow' || preset.group === 'General',
));
const meadowPresetIds = new Set(MEADOW_ASSET_PRESETS.map(preset => preset.id));

// Keep the old IDs recognizable for migrating saved environments.
export const RETIRED_SPECIES = new Set([
  ...ASSET_PRESETS.filter(preset => !meadowPresetIds.has(preset.id)).map(preset => preset.id),
  'dry_shrub', 'cactus', 'fallen_log', 'sandstone', 'sandstone_outcrop', 'desert_pebble', 'rock_outcrop',
]);
export const LEGACY_SPECIES=Object.freeze({grass:['grass','grass_short','grass_tall','grass_clump'],flowers:['flower','flower_white','flower_blue','flower_yellow'],plants:['shrub','bush','sapling','fern','weed','groundCover'],rocks:['rock'],boulders:['boulder'],pebbles:['pebble']});
export function assetLayer(definition){
  const a=definition.archetype;
  if(a==='grass')return 'grass';
  if(a==='flower')return 'flowers';
  if(PLANT_ARCHETYPES.includes(a)||a==='fallen_log')return 'plants';
  if(a==='pebble')return 'pebbles';
  if(['boulder','outcrop'].includes(a))return 'boulders';
  if(ROCK_ARCHETYPES.includes(a))return 'rocks';
  throw new Error(`Unknown asset form: ${a}`);
}
export function layerSpecies(layer,custom=[]){
  return [...LEGACY_SPECIES[layer].map(id=>({id,name:id.replaceAll('_',' ')})),
    ...MEADOW_ASSET_PRESETS.filter(p=>p.layer===layer).map(p=>({id:p.id,name:p.name})),
    ...custom.filter(c=>['rocks','boulders','pebbles'].includes(layer)?ROCK_ARCHETYPES.includes(c.definition.archetype):assetLayer(c.definition)===layer).map(c=>({id:c.id,name:c.id}))];
}
