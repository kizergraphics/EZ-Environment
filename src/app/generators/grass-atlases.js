import meadowAtlas from './grass-atlas-v2.json' with { type: 'json' };

export const GRASS_TWELVE_LAYOUT = 'naturalTwelve';
export const GRASS_TYPES = Object.freeze({
  'meadow-v1': 'Meadow Grass',
  'fine-fescue': 'Fine Fescue',
  'blue-oat': 'Blue Oat Grass',
  'purple-fountain': 'Purple Fountain Grass',
  'feather-reed': 'Feather Reed Grass',
  'prairie-switchgrass': 'Prairie Switchgrass',
  'dune-marram': 'Dune Marram',
  'golden-hakone': 'Golden Hakone Grass',
  'wetland-sedge': 'Wetland Sedge',
});

export const GRASS_VARIANTS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => `variant-${String(index + 1).padStart(2, '0')}`),
);
// The species sheets pack 12 foliage tiles and a seed-head tile into one draw.
const slotSize = 320, gutter = 12, atlasSize = slotSize * 4, regionSize = slotSize - 2 * gutter;
const speciesRegions = Object.fromEntries([...GRASS_VARIANTS, 'seeds'].map((key, index) => {
  const x = index % 4 * slotSize + gutter;
  const y = Math.floor(index / 4) * slotSize + gutter;
  return [key, {
    uv: [
      (x + .5) / atlasSize,
      1 - (y + regionSize - .5) / atlasSize,
      (x + regionSize - .5) / atlasSize,
      1 - (y + .5) / atlasSize,
    ],
  }];
}));
const speciesAtlases = Object.fromEntries(
  ['meadow-extended', ...Object.keys(GRASS_TYPES).filter((id) => id !== 'meadow-v1')].map((id) => [
    id, { revision: 3, path: `/textures/grass/species/${id}.png`, regions: speciesRegions },
  ]),
);
const originalCells = Object.keys(meadowAtlas.regions);
const legacyVariants = Object.fromEntries(
  originalCells.filter((cell) => cell !== 'seeds').map((cell, index) => [cell, GRASS_VARIANTS[index]]),
);
export const GRASS_CARD_TEXTURES = Object.freeze([...originalCells, ...GRASS_VARIANTS]);

export function grassAtlasId(definition) {
  if (definition.grassAtlas !== 'meadow-v1') return definition.grassAtlas;
  const edits = definition.grassCardEdits?.[definition.cardLayout];
  return definition.cardLayout === GRASS_TWELVE_LAYOUT || edits?.some((edit) => GRASS_VARIANTS.includes(edit.texture))
    ? 'meadow-extended'
    : 'meadow-v1';
}

export function grassAtlas(id) {
  return id === 'meadow-v1' ? meadowAtlas : Object.hasOwn(speciesAtlases, id) ? speciesAtlases[id] : undefined;
}

export function grassAtlasRegion(atlas, cell) {
  return atlas.regions[cell] ?? atlas.regions[legacyVariants[cell]];
}

export function grassPlaneTextureOptions(definition) {
  const atlas = grassAtlas(grassAtlasId(definition));
  const current = definition.grassCardEdits?.[definition.cardLayout] ?? [];
  const options = Object.keys(atlas.regions).map((cell) => [
    cell,
    cell === 'seeds' ? 'Seed heads' : cell.replace(/^variant-/, 'Variant ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase()),
  ]);
  for (const { texture } of current) {
    if (texture && legacyVariants[texture] && !atlas.regions[texture] && !options.some(([key]) => key === texture)) {
      options.push([texture, `Variant ${legacyVariants[texture].slice(-2)} (saved)`]);
    }
  }
  return options;
}
