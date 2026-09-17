import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { PLANT_ARCHETYPES, PLANT_PRESETS, LEAF_DESIGNS, PLANT_BARK_TYPES, createPlantDefinition, generatePlant } from '../src/app/generators/plants.js';

function geometryHash(asset) {
  const hash = createHash('sha256');
  for (const group of asset.lods) group.traverse(object => {
    if (!object.isMesh) return;
    for (const name of ['position', 'normal', 'uv', 'windWeight', 'color']) hash.update(Buffer.from(object.geometry.attributes[name].array.buffer));
    hash.update(Buffer.from(object.geometry.index.array.buffer));
  });
  return hash.digest('hex');
}

function assertValidGeometry(asset) {
  const counts = asset.lods.map(group => group.userData.triangles);
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `LOD triangles must strictly decrease: ${counts}`);
  assert.equal(asset.object3D, asset.lods[0]);
  asset.lods.forEach((group, level) => {
    assert.equal(group.name, `lod${level}`);
    assert.equal(group.parent, null);
    assert.ok(group.children.length >= 1 && group.children.length <= 4, 'Geometry must be batched by material.');
    group.traverse(object => {
      if (!object.isMesh) return;
      const geometry = object.geometry;
      const position = geometry.getAttribute('position');
      assert.ok(geometry.index && geometry.index.count > 0 && geometry.index.count % 3 === 0);
      for (const name of ['position', 'normal', 'uv', 'windWeight', 'color']) {
        const attribute = geometry.getAttribute(name);
        assert.equal(attribute.count, position.count, `Attribute ${name} must match vertices.`);
        assert.ok(attribute.array.every(Number.isFinite), `${name} must be finite.`);
      }
      assert.ok(geometry.getAttribute('windWeight').array.every(value => value >= 0 && value <= 1));
      assert.ok(geometry.index.array.every(value => value >= 0 && value < position.count));
      assert.ok(geometry.boundingBox && geometry.boundingSphere.radius > 0);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i < geometry.index.count; i += 3) {
        a.fromBufferAttribute(position, geometry.index.getX(i));
        b.fromBufferAttribute(position, geometry.index.getX(i + 1));
        c.fromBufferAttribute(position, geometry.index.getX(i + 2));
        const area = b.sub(a).cross(c.sub(a)).lengthSq();
        assert.ok(area > 1e-25, `Nonzero triangle area required in ${object.name} at ${i}.`);
      }
    });
    const bounds = new THREE.Box3().setFromObject(group);
    assert.ok(bounds.min.y >= -1e-6, 'Ground pivot cannot place geometry underground.');
    assert.ok(bounds.min.y < asset.definition.height * .05, 'All LOD bases must remain near ground.');
  });
  const bounds = new THREE.Box3().setFromObject(asset.object3D).getSize(new THREE.Vector3());
  assert.ok(Math.abs(bounds.y - asset.definition.height) < 1e-5);
  assert.ok(Math.abs(Math.max(bounds.x, bounds.z) - asset.definition.width) < 1e-5);
}

for (const archetype of PLANT_ARCHETYPES) {
  test(`${archetype}: reproducible original geometry, valid attributes and reduced LODs`, () => {
    const definition = createPlantDefinition(archetype);
    const first = generatePlant(definition);
    const second = generatePlant(JSON.parse(JSON.stringify(definition)));
    const changed = generatePlant({ ...definition, seed: definition.seed + 1 });
    assert.deepEqual(first.definition, definition);
    assert.equal(first.definitionHash, second.definitionHash);
    assert.equal(geometryHash(first), geometryHash(second));
    assert.notEqual(first.definitionHash, changed.definitionHash);
    assert.notEqual(geometryHash(first), geometryHash(changed));
    assertValidGeometry(first);
    first.dispose(); second.dispose(); changed.dispose();
  });
}

test('every archetype has a curated preset and presets can round trip through ObjectLoader', () => {
  for (const archetype of PLANT_ARCHETYPES) assert.ok(PLANT_PRESETS.some(preset => preset.definition.archetype === archetype));
  assert.equal(new Set(PLANT_PRESETS.map(preset => preset.id)).size, PLANT_PRESETS.length);
  for (const preset of PLANT_PRESETS) {
    const asset = generatePlant(preset.definition);
    const restored = new THREE.ObjectLoader().parse(JSON.parse(JSON.stringify(asset.object3D.toJSON())));
    assert.equal(restored.userData.definitionHash, asset.definitionHash);
    const originalBounds = new THREE.Box3().setFromObject(asset.object3D);
    const restoredBounds = new THREE.Box3().setFromObject(restored);
    assert.deepEqual(originalBounds, restoredBounds);
    assert.equal(restored.children.length, asset.object3D.children.length);
    for (const mesh of restored.children) assert.ok(mesh.geometry.getAttribute('windWeight'));
    asset.dispose();
    restored.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
  }
});

test('legacy Bush 1-3 names are represented by distinct Forest plant presets', () => {
  assert.equal(PLANT_PRESETS.length, 30);
  const migrated = ['bush-1', 'bush-2', 'bush-3'].map(id => PLANT_PRESETS.find(preset => preset.id === id));
  assert.deepEqual(migrated.map(preset => preset?.name), ['Bush 1', 'Bush 2', 'Bush 3']);
  assert.ok(migrated.every(preset => preset?.group === 'Forest'));
  assert.equal(new Set(migrated.map(preset => preset.definition.leafDesign)).size, 3);
  assert.equal(new Set(migrated.map(preset => preset.definition.barkType)).size, 3);
  assert.equal(migrated[2].definition.archetype, 'bush', 'Bush 3 remains a shrub form even though it uses conifer needles.');
});

test('extreme valid values remain bounded and produce usable geometry', () => {
  for (const archetype of PLANT_ARCHETYPES) {
    for (const overrides of [
      { height: .05, width: .05, density: .1, branches: 1, stemCount: 1, leafSize: .015, curvature: 0, flowerCount: 1, petalCount: 4 },
      { height: 8, width: 8, density: 2.5, branches: 20, stemCount: 16, leafSize: .7, curvature: 2, flowerCount: 16, petalCount: 16 },
    ]) {
      const asset = generatePlant(createPlantDefinition(archetype, overrides));
      assertValidGeometry(asset);
      assert.ok(asset.lods[0].userData.triangles < 600000, 'Resource count must remain bounded at valid extremes.');
      asset.dispose();
    }
  }
});

test('validation rejects nonfinite values, invalid colors and unsupported definitions', () => {
  for (const value of [NaN, Infinity, '1']) assert.throws(() => createPlantDefinition('shrub', { height: value }), /finite number/);
  assert.throws(() => createPlantDefinition('unknown-plant'), /Unknown plant archetype/);
  assert.throws(() => createPlantDefinition('shrub', { version: 2 }), /Unsupported/);
  assert.throws(() => createPlantDefinition('shrub', { leafColor: 'red' }), /hex color/);
  assert.throws(() => generatePlant(null), /definition/);
  assert.throws(() => generatePlant(createPlantDefinition(), { quality: 'bad' }), /quality/);
  const clamped = createPlantDefinition('shrub', { height: -10, width: 1e8, branches: 999, density: 999 });
  assert.equal(clamped.height, .05); assert.equal(clamped.width, 8); assert.equal(clamped.branches, 20); assert.equal(clamped.density, 2.5);
  assert.equal(createPlantDefinition('shrub', { leafColor: 0xaabbcc }).leafColor, '#aabbcc');
  assert.throws(() => createPlantDefinition('shrub', { leafDesign: 'same-leaf' }), /leafDesign/);
  assert.throws(() => createPlantDefinition('shrub', { barkType: 'Bark999' }), /barkType/);
});

test('leaf and bark designs are serialized, legacy leafShape maps forward, and silhouettes differ', () => {
  assert.equal(createPlantDefinition('groundCover', { leafShape: 'clover' }).leafDesign, 'trifoliate');
  assert.equal(createPlantDefinition('groundCover', { leafShape: 'lance' }).leafDesign, 'lanceolate');
  assert.equal(createPlantDefinition('groundCover', { leafShape: 'clover' }).leafShape, undefined);
  assert.ok(LEAF_DESIGNS.length >= 10);
  assert.ok(PLANT_BARK_TYPES.length >= 4);
  const leafyPresets = PLANT_PRESETS.filter(preset => !['cactus', 'deadwood'].includes(preset.definition.archetype));
  const woodyPresets = PLANT_PRESETS.filter(preset => ['shrub', 'bush', 'sapling', 'coniferSapling'].includes(preset.definition.archetype));
  assert.ok(new Set(leafyPresets.map(preset => preset.definition.leafDesign)).size >= 8);
  assert.ok(new Set(woodyPresets.map(preset => preset.definition.barkType)).size >= 4);
  const hashes = new Set();
  for (const leafDesign of LEAF_DESIGNS) {
    const asset = generatePlant(createPlantDefinition('groundCover', { seed: 27, leafDesign }));
    hashes.add(geometryHash(asset));
    const foliage = asset.object3D.children.find(mesh => mesh.userData.materialSlot === 'leaves');
    assert.equal(foliage.material.userData.pbrVariant, leafDesign);
    asset.dispose();
  }
  assert.equal(hashes.size, LEAF_DESIGNS.length, 'Every leaf design must produce a distinct mesh silhouette.');
  const shrub = generatePlant(createPlantDefinition('shrub', { barkType: 'Bark014' }));
  const stems = shrub.object3D.children.find(mesh => mesh.userData.materialSlot === 'stems');
  assert.equal(stems.material.userData.pbrFamily, 'bark');
  assert.equal(stems.material.userData.pbrVariant, 'Bark014');
  shrub.dispose();
});

test('woody presets expose natural bark and retain authored tints', () => {
  const presets = PLANT_PRESETS.filter(p => ['shrub', 'bush', 'sapling', 'coniferSapling'].includes(p.definition.archetype));
  for (const preset of presets) assert.equal(preset.definition.stemColor, '#ffffff', preset.id);
  const definition = createPlantDefinition('shrub', { stemColor: '#705b3d' });
  const asset = generatePlant(JSON.parse(JSON.stringify(definition)));
  assert.equal(asset.object3D.children[0].material.color.getHexString(), '705b3d', 'Saved or custom colors remain authored choices.');
  asset.dispose();
});

test('bark keeps its surface scale on slender branches and across LODs', () => {
  const asset = generatePlant(createPlantDefinition('shrub'));
  const ranges = asset.lods.map(lod => {
    const uv = lod.children.find(mesh => mesh.userData.materialSlot === 'stems').geometry.attributes.uv;
    let maxU = 0, maxV = 0;
    for (let i = 0; i < uv.count; i++) { maxU = Math.max(maxU, uv.getX(i)); maxV = Math.max(maxV, uv.getY(i)); }
    assert.ok(maxV > 3, 'A long branch must tile bark along its length, not stretch one image.');
    assert.ok(maxU < 1, 'A thin branch must sample a strip instead of compressing the whole source.');
    return [maxU, maxV];
  });
  assert.deepEqual(ranges[0], ranges[1]);
  assert.deepEqual(ranges[0], ranges[2]);
  asset.dispose();
});

test('preview quality reduces geometry while preserving the definition and all three LODs', () => {
  for (const archetype of PLANT_ARCHETYPES) {
    const definition = createPlantDefinition(archetype);
    const full = generatePlant(definition), preview = generatePlant(definition, {quality:'preview'});
    assert.equal(full.definitionHash, preview.definitionHash);
    assert.ok(preview.lods[0].userData.triangles < full.lods[0].userData.triangles);
    assertValidGeometry(preview);
    full.dispose(); preview.dispose();
  }
});

test('preserves extension metadata with a stable definition hash independent of key order', () => {
  const first = generatePlant(createPlantDefinition('fern', { label: 'Forest', custom: 7 }));
  const second = generatePlant(createPlantDefinition('fern', { custom: 7, label: 'Forest' }));
  assert.equal(first.definition.label, 'Forest');
  assert.equal(first.definitionHash, second.definitionHash);
  first.dispose(); second.dispose();
});

test('disposal releases every owned geometry and shared material exactly once', () => {
  const asset = generatePlant(createPlantDefinition('flower'));
  const geometries = new Set(), materials = new Set();
  asset.lods.forEach(group => group.traverse(object => { if (object.isMesh) { geometries.add(object.geometry); materials.add(object.material); } }));
  let geometryDisposals = 0, materialDisposals = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const material of materials) material.addEventListener('dispose', () => materialDisposals++);
  asset.dispose(); asset.dispose();
  assert.equal(geometryDisposals, geometries.size);
  assert.equal(materialDisposals, materials.size);
});
