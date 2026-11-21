import { TreePreset } from 'ez-environment';
import { companionMaps, getSurfaceMaps } from './materials/surface-maps.js';
import { getWoodMaps } from './materials/wood-surface.js';

const speciesSurfaces = {
  'Paper Birch': 'paper-birch',
  'Weeping Willow': 'weeping-willow',
  'Sugar Maple': 'sugar-maple',
  Ginkgo: 'ginkgo',
  'Blue Spruce': 'blue-spruce',
  'Coast Redwood': 'coast-redwood',
  'Lebanon Cedar': 'lebanon-cedar',
  'Fan Palm': 'fan-palm',
};
const speciesIds = new Set(Object.values(speciesSurfaces));

// The numbered bark presets resolve to the original ambientCG material sets.
export const BarkType = {
  Bark001: 'Bark001',
  Bark002: 'Bark002',
  Bark003: 'Bark003',
  Bark004: 'Bark004',
  Bark006: 'Bark006',
  Bark007: 'Bark007',
  Bark008: 'Bark008',
  Bark012: 'Bark012',
  Bark013: 'Bark013',
  Bark014: 'Bark014',
  Bark015: 'Bark015',
  ...speciesSurfaces,
};
const barkIds = new Set(Object.values(BarkType));

export const LeafType = {
  Ash: 'ash',
  Aspen: 'aspen',
  Oak: 'oak',
  Pine: 'pine',
  ...speciesSurfaces,
};

// Bush 1-3 remain public TreePreset entries for library/backward compatibility,
// but the desktop app presents their Plant-native replacements instead.
const PLANT_NATIVE_TREE_PRESETS = new Set(['Bush 1', 'Bush 2', 'Bush 3']);
export const APP_TREE_PRESET_NAMES = Object.freeze(
  Object.keys(TreePreset).filter(name => !PLANT_NATIVE_TREE_PRESETS.has(name)),
);

export function getBarkMaps(type) {
  if (!barkIds.has(type)) return null;
  const dir = `${type}_1K-JPG`;
  const base = `/textures/bark/${dir}/${dir}`;
  const species = `/textures/trees/${type}`;
  const paths = speciesIds.has(type)
    ? [`${species}/bark-color.jpg`, `${species}/bark-normal.png`, `${species}/bark-roughness.jpg`]
    : ['_Color.jpg', '_NormalGL.jpg', '_Roughness.jpg'].map(suffix => base + suffix);
  const { map, normalMap, roughnessMap } = getSurfaceMaps(type, paths);
  return { color: map, normal: normalMap, roughness: roughnessMap };
}

function getLeafMaps(type) {
  const base = `/textures/trees/${type}`;
  const paths = speciesIds.has(type)
    ? [`${base}/leaf-color.png`, `${base}/leaf-normal.png`, `${base}/leaf-roughness.jpg`]
    : companionMaps(`/textures/leaves/${type}.png`);
  return getSurfaceMaps(`${type} leaves`, paths, { premultiplyAlpha: true });
}

export function getLeafMap(type) {
  return getLeafMaps(type).map;
}

/**
 * Assigns bark + leaf textures onto the tree's options based on its current
 * `bark.type` and `leaves.type` identifiers. Call this before `tree.generate()`
 * whenever the type strings change.
 * @param {import('ez-environment').Tree} tree
 */
export function applyTreeTextures(tree) {
  const barkMaps = getBarkMaps(tree.options.bark.type);
  if (barkMaps) {
    tree.options.bark.maps.color = barkMaps.color;
    tree.options.bark.maps.normal = barkMaps.normal;
    tree.options.bark.maps.roughness = barkMaps.roughness;
  }
  Object.assign(tree.options.leaves, getLeafMaps(tree.options.leaves.type));
  tree.options.trellis.maps = getWoodMaps('wood');
  tree.options.trellis.endMaps = getWoodMaps('endgrain');
}

/**
 * Loads a named preset onto the tree, applying the matching texture set in
 * the same step so the first generate sees the textures.
 * @param {import('ez-environment').Tree} tree
 * @param {string} name - key into TreePreset registry
 * @param {boolean} generate - set false to skip the generate step when the
 * caller will generate the tree itself (e.g. via generateLODs)
 */
export function loadPresetWithTextures(tree, name, generate = true) {
  if (!Object.hasOwn(TreePreset, name)) return;
  const options = new tree.options.constructor();
  options.copy(structuredClone(TreePreset[name]));
  tree.options.copy(options);
  applyTreeTextures(tree);
  if (generate) {
    tree.generate();
  }
}
