const entries = [
  ['legacy-broad', 'Classic broad leaf', '/textures/plants/leaf-surface-v1.png', ['oval','serrated'], null, 1, .65],
  ['legacy-palmate', 'Classic palmate leaf', '/textures/plants/leaf-surface-palmate-v1.png', ['lobed','heart','trifoliate'], null, 1, .65],
  ['legacy-parallel', 'Classic parallel leaf', '/textures/plants/leaf-surface-parallel-v1.png', ['lanceolate','fernPinna','succulent'], null, 1, .55],
  ['legacy-needle', 'Classic needle surface', '/textures/plants/leaf-surface-needle-v1.png', ['coniferNeedle','cushionScale','grassBlade'], null, 1, .45],
  ['woodland-shrub-v1', 'Woodland shrub', '/textures/plants/shrubs/woodland-shrub-v1.png', ['lobed'], '#587939', 4, .55],
  ['boxwood-v1', 'Boxwood', '/textures/plants/shrubs/boxwood-v1.png', ['oval'], '#496638', 4, .38],
  ['meadow-bush-v1', 'Meadow bush', '/textures/plants/shrubs/meadow-bush-v1.png', ['serrated'], '#758c46', 4, .45],
  ['copper-bush-v1', 'Copperleaf bush', '/textures/plants/shrubs/copper-bush-v1.png', ['heart'], '#a76c43', 4, .48],
  ['bush-1-v1', 'Bush 1 · hazel', '/textures/plants/shrubs/bush-1-v1.png', ['serrated'], '#54743d', 4, .62],
  ['bush-2-v1', 'Bush 2 · heart leaf', '/textures/plants/shrubs/bush-2-v1.png', ['heart'], '#718849', 4, .42],
  ['bush-3-v1', 'Bush 3 · juniper', '/textures/plants/shrubs/bush-3-v1.png', ['coniferNeedle'], '#3f6444', 4, .34],
  ['berry-thicket-v1', 'Berry thicket', '/textures/plants/shrubs/berry-thicket-v1.png', ['serrated'], '#758c46', 4, .7],
  ['sagebrush-v1', 'Sagebrush', '/textures/plants/shrubs/sagebrush-v1.png', ['lanceolate'], '#98a18b', 4, .3],
  ['heather-cushion-v1', 'Heather cushion', '/textures/plants/shrubs/heather-cushion-v1.png', ['cushionScale'], '#64743d', 4, .5],
  ['generic-shrub-v1', 'Generic shrub', '/textures/plants/shrubs/generic-shrub-v1.png', ['lobed'], '#587939', 4, .45],
  ['generic-bush-v1', 'Generic bush', '/textures/plants/shrubs/generic-bush-v1.png', ['serrated'], '#758c46', 4, .48],
  ['dry-shrub-v1', 'Dry shrub', '/textures/plants/shrubs/dry-shrub-v1.png', ['lobed'], '#8e8b64', 4, .58],
];

export const LEAF_TEXTURE_REGISTRY = Object.freeze(Object.fromEntries(entries.map(([id,name,path,compatibleDesigns,baselineTint,atlasCells,normalStrength]) => [id,Object.freeze({id,name,path,compatibleDesigns:Object.freeze(compatibleDesigns),baselineTint,atlasCells,normalStrength})])));
export const LEAF_TEXTURES = Object.freeze(Object.keys(LEAF_TEXTURE_REGISTRY));

export function leafTextureInfo(id) {
  const texture=LEAF_TEXTURE_REGISTRY[id];
  if(!texture)throw new TypeError(`Unknown plant leafTexture: ${id}`);
  return texture;
}

export function legacyLeafTexture(design='oval') {
  if(['lobed','heart','trifoliate'].includes(design))return 'legacy-palmate';
  if(['lanceolate','fernPinna','succulent'].includes(design))return 'legacy-parallel';
  if(['coniferNeedle','cushionScale','grassBlade'].includes(design))return 'legacy-needle';
  return 'legacy-broad';
}

export function leafTexturesForDesign(design) {
  return Object.values(LEAF_TEXTURE_REGISTRY).filter(texture=>texture.compatibleDesigns.includes(design));
}
