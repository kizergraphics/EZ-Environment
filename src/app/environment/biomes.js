import { DEFAULT_OPTIONS, LAYERS, validateOptions } from './options.js';
import { RETIRED_SPECIES } from '../generators/catalog.js';

export const MEADOW = Object.freeze({
  name: 'Meadow',
  surface: 'meadow-soil',
  colors: ['#687247', '#8d805c'],
  terrain: { form: 'rolling', amplitude: 3.5, scale: 65 },
  trees: { density: .0006, spacing: 15, presets: ['Ash Medium', 'Oak Small'] },
  lighting: { ...DEFAULT_OPTIONS.lighting },
  wind: .28,
  layers: {
    grass: { density: 1.5, size: 1.5, species: 'grass', color: '#738347', patchiness: .28, speciesChoices: [
      { id: 'grass', weight: 7 }, { id: 'short-meadow-grass', weight: 2 }, { id: 'tall-seed-grass', weight: 1 },
    ] },
    flowers: { density: .08, size: 1.1, species: 'flower_white', patchiness: .8, speciesChoices: [
      { id: 'flower_white', weight: 4 }, { id: 'flower_yellow', weight: 3 }, { id: 'flower_blue', weight: 1 },
    ] },
    plants: { density: .007, species: 'bush', size: 1.2, speciesChoices: [
      { id: 'bush', weight: 2 }, { id: 'clover-groundcover', weight: 5 },
    ] },
    rocks: { density: .0012, speciesChoices: [{ id: 'rock', weight: 1 }, { id: 'low-fieldstone', weight: 3 }] },
    boulders: { density: .00015, speciesChoices: [{ id: 'boulder', weight: 1 }, { id: 'glacial-erratic', weight: 3 }] },
    pebbles: { density: .014 },
  },
});

export function migrateMeadowSpecies(options) {
  for (const key of LAYERS) {
    const layer = options.layers[key];
    const choices = layer.speciesChoices.filter(choice => !RETIRED_SPECIES.has(choice.id));
    if (RETIRED_SPECIES.has(layer.species)) {
      layer.species = MEADOW.layers[key].species ?? DEFAULT_OPTIONS.layers[key].species;
      options.modified = true;
    }
    if (choices.length !== layer.speciesChoices.length) {
      layer.speciesChoices = choices;
      options.modified = true;
    }
  }
  return options;
}

export function applyMeadowPreset(current) {
  const layers = Object.fromEntries(LAYERS.map(key => [key, {
    ...DEFAULT_OPTIONS.layers[key],
    ...MEADOW.layers[key],
    densityMap: current.layers?.[key]?.densityMap ?? null,
  }]));
  const exclusions = current.exclusions ?? [];
  return validateOptions({
    ...current,
    biome: 'meadow',
    composition: 'biome',
    biomeRevision: 2,
    modified: false,
    includeAuthoredTree: false,
    terrain: MEADOW.terrain,
    lighting: MEADOW.lighting,
    wind: { ...DEFAULT_OPTIONS.wind, strength: MEADOW.wind },
    layers,
    treeExclusions: [],
    canopySources: [],
    exclusions: current.composition === 'legacy'
      ? exclusions.filter(s => !(s.type === 'circle' && s.x === 0 && s.z === 0 && s.radius === 7))
      : exclusions,
  });
}
