import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAssetTriangleTargets,
  triangleCount,
  triangleSimplifierReady,
  validateTriangleTargets,
} from '../src/app/generators/triangle-targets.js';
import { createPlantDefinition, generatePlant } from '../src/app/generators/plants.js';
import { createRockDefinition } from '../src/app/generators/rocks.js';
import { makeAuthoredSpecies } from '../src/app/environment/species.js';

test('triangle targets allow automatic levels and reject invalid or increasing budgets', () => {
  assert.equal(validateTriangleTargets([null, null, null]), undefined);
  assert.deepEqual(validateTriangleTargets([500, null, 200]), [500, null, 200]);
  for (const targets of [[500], [0, null, null], [500, 1.5, null], [500, null, 600]]) {
    assert.throws(() => validateTriangleTargets(targets), /triangle|target/i);
  }
});

test('restored authored rocks generate the same budgeted LODs on all variants', async () => {
  const triangleTargets = [330, 160, 48];
  const definition = createRockDefinition('rock', { triangleTargets });
  const first = await makeAuthoredSpecies(definition);
  const restored = await makeAuthoredSpecies(JSON.parse(JSON.stringify(definition)));
  try {
    assert.equal(first.definitionHash, restored.definitionHash);
    assert.deepEqual(first.lods.map(triangleCount), triangleTargets);
    for (const [index, variant] of first.variants.entries()) {
      assert.deepEqual(variant.lods.map(triangleCount), restored.variants[index].lods.map(triangleCount));
      for (const lod of variant.lods) {
        const { index, attributes } = lod.children[0].geometry;
        assert.ok(index.count > 0);
        assert.equal(attributes.normal.count, attributes.position.count);
        assert.equal(attributes.uv.count, attributes.position.count);
      }
    }
  } finally {
    first.dispose();
    restored.dispose();
  }
});

test('grass budgets preserve whole cards and leave every original plane available to edit', async () => {
  await triangleSimplifierReady;
  const raw = generatePlant(createPlantDefinition('grass', { triangleTargets: [7, 4, 1] }));
  const asset = applyAssetTriangleTargets(raw, { keepEditorSource: true });
  try {
    assert.deepEqual(asset.lods.map(triangleCount), [6, 4, 2]);
    assert.equal(asset.editorObject, raw.lods[0]);
    assert.ok(triangleCount(asset.editorObject) > triangleCount(asset.lods[0]));
    for (const lod of asset.lods) {
      const { attributes, userData } = lod.children[0].geometry;
      assert.equal(attributes.position.count, userData.cardIndices.length * 4);
      assert.equal(attributes.uv.count, attributes.position.count);
      assert.equal(attributes.windWeight.count, attributes.position.count);
    }
  } finally {
    asset.dispose();
  }
});
