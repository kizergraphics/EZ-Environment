import { companionMaps, getSurfaceMaps, loadSurfaceMaps } from './surface-maps.js';

const woodSources = Object.freeze({
  wood: '/textures/wood/weathered-grain-v1',
  endgrain: '/textures/wood/endgrain-v1',
});

function woodPaths(id) {
  if (!Object.hasOwn(woodSources, id)) throw new Error(`Unknown wood surface ${id}.`);
  const base = woodSources[id];
  return companionMaps(`${base}-color.jpg`, base);
}

export function getWoodMaps(id = 'wood') {
  return getSurfaceMaps(id, woodPaths(id));
}

export async function loadWoodMaps(id = 'wood') {
  return loadSurfaceMaps(id, woodPaths(id));
}
