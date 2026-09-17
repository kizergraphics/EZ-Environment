import test from 'node:test';
import assert from 'node:assert/strict';
import { TreePreset } from '../build/ez-tree.es.js';
import { APP_TREE_PRESET_NAMES } from '../src/app/textures.js';
import { createPlantDefinition, generatePlant } from '../src/app/generators/plants.js';
import { createRockDefinition, generateRock, rockVariantIndex } from '../src/app/generators/rocks.js';

test('Bush Tree presets remain public while only their Plant replacements appear in app navigation', () => {
  const migrated = ['Bush 1', 'Bush 2', 'Bush 3'];
  assert.equal(Object.keys(TreePreset).length, 16);
  assert.deepEqual(
    Object.keys(TreePreset).filter(name => !APP_TREE_PRESET_NAMES.includes(name)),
    migrated,
  );
  assert.equal(APP_TREE_PRESET_NAMES.length, 13);
});

test('legacy version-1 plant definitions load with deterministic leaf and bark defaults', () => {
  for (const legacy of [
    { version: 1, archetype: 'shrub', seed: 41 },
    { version: 1, archetype: 'groundCover', seed: 42, leafShape: 'clover' },
    { version: 1, archetype: 'weed', seed: 43, leafShape: 'lance' },
  ]) {
    const definition = createPlantDefinition(legacy.archetype, legacy);
    assert.equal(definition.version, 1);
    assert.ok(definition.leafDesign);
    assert.ok(definition.barkType);
    assert.equal(Object.hasOwn(definition, 'leafShape'), false);
    const first = generatePlant(definition);
    const second = generatePlant(JSON.parse(JSON.stringify(definition)));
    try {
      assert.equal(first.definitionHash, second.definitionHash);
      assert.deepEqual(second.definition, definition);
    } finally {
      first.dispose();
      second.dispose();
    }
  }
  assert.equal(createPlantDefinition('groundCover', { leafShape: 'clover' }).leafDesign, 'trifoliate');
  assert.equal(createPlantDefinition('weed', { leafShape: 'lance' }).leafDesign, 'lanceolate');
});

test('legacy version-1 rocks keep the old schema and do not enter variant-bank export behavior', () => {
  const definition = createRockDefinition('rock', { version: 1, seed: 44, shapeProfile: 'wedge' });
  assert.equal(definition.version, 1);
  assert.equal(Object.hasOwn(definition, 'shapeProfile'), false);
  const first = generateRock(definition, { variants: true });
  const second = generateRock(JSON.parse(JSON.stringify(definition)), { variants: true });
  try {
    assert.equal(first.variants, undefined);
    assert.equal(first.definitionHash, second.definitionHash);
    assert.deepEqual(first.definition, definition);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('environment keeps rock variants at LOD0 and collapses distant LOD batches', () => {
  const asset = generateRock(createRockDefinition('rock', { seed: 45 }), { variants: true });
  try {
    assert.deepEqual([0, 1, 2].map(seed => rockVariantIndex(asset, seed, 0)), [0, 1, 2]);
    assert.deepEqual([0, 1, 2].map(seed => rockVariantIndex(asset, seed, 1)), [0, 0, 0]);
    assert.deepEqual([0, 1, 2].map(seed => rockVariantIndex(asset, seed, 2)), [0, 0, 0]);
  } finally {
    asset.dispose();
  }
});
