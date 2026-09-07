import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  ROCK_PRESETS,
  createRockDefinition,
  generateRock,
} from '../src/app/generators/rocks.js';

function fingerprint(asset) {
  return asset.lods.map((group) =>
    group.children.map((mesh) => ({
      position: Array.from(mesh.geometry.attributes.position.array),
      normals: Array.from(mesh.geometry.attributes.normal.array),
      colors: Array.from(mesh.geometry.attributes.color.array),
      indices: Array.from(mesh.geometry.index.array),
      transform: [
        mesh.position.toArray(),
        mesh.rotation.toArray(),
        mesh.scale.toArray(),
      ],
    })),
  );
}

function verifyClosed(geometry) {
  const index = geometry.index.array;
  const positions = geometry.attributes.position;
  const edges = new Map();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  let volume = 0;
  for (const attribute of Object.values(geometry.attributes))
    assert.ok(Array.from(attribute.array).every(Number.isFinite));
  for (let i = 0; i < index.length; i += 3) {
    const vertices = Array.from(index.slice(i, i + 3));
    assert.equal(new Set(vertices).size, 3);
    for (let edge = 0; edge < 3; edge++) {
      const x = vertices[edge],
        y = vertices[(edge + 1) % 3];
      const key = x < y ? `${x}:${y}` : `${y}:${x}`;
      const previous = edges.get(key) ?? { count: 0, direction: 0 };
      previous.count++;
      previous.direction += x < y ? 1 : -1;
      edges.set(key, previous);
    }
    a.fromBufferAttribute(positions, vertices[0]);
    b.fromBufferAttribute(positions, vertices[1]);
    c.fromBufferAttribute(positions, vertices[2]);
    assert.ok(
      ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq() > 1e-22,
      'Triangle has nonzero area',
    );
    volume += a.dot(ab.crossVectors(b, c)) / 6;
  }
  assert.ok(
    volume > 0,
    'Mesh has positive volume and consistent outward winding',
  );
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, 'Every edge has exactly two incident faces');
    assert.equal(
      edge.direction,
      0,
      'Adjacent faces orient the common edge oppositely',
    );
  }
  assert.equal(
    positions.count - edges.size + index.length / 3,
    2,
    'Closed sphere topology',
  );
  assert.ok(
    Math.abs(geometry.boundingBox.min.y) < 1e-6,
    'Base pivot touches ground',
  );
}

test('all curated rock presets produce closed finite geometry and decreasing LODs', () => {
  for (const preset of ROCK_PRESETS) {
    const asset = generateRock(preset.definition);
    assert.equal(asset.object3D, asset.lods[0]);
    assert.deepEqual(
      asset.lods.map((group) => group.name),
      ['lod0', 'lod1', 'lod2'],
    );
    assert.equal(new Set(asset.lods).size, 3);
    const counts = asset.lods.map((group) =>
      group.children.reduce(
        (sum, mesh) => sum + mesh.geometry.index.count / 3,
        0,
      ),
    );
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2]);
    for (const group of asset.lods) {
      const geometries = new Set(group.children.map((mesh) => mesh.geometry));
      for (const geometry of geometries) verifyClosed(geometry);
      for (const mesh of group.children) {
        assert.equal(mesh.material.metalness, 0);
        assert.equal(mesh.material.map, null);
      }
    }
    asset.dispose();
  }
});

test('definition and geometry round trips are deterministic and independent of property order', () => {
  const definition = createRockDefinition('rock');
  const first = generateRock(definition);
  const second = generateRock(JSON.parse(JSON.stringify(definition)));
  const reordered = generateRock(
    Object.fromEntries(Object.entries(definition).reverse()),
  );
  assert.equal(first.definitionHash, second.definitionHash);
  assert.equal(first.definitionHash, reordered.definitionHash);
  assert.deepEqual(fingerprint(first), fingerprint(second));
  const changed = generateRock({ ...definition, seed: definition.seed + 1 });
  assert.notEqual(first.definitionHash, changed.definitionHash);
  assert.notDeepEqual(fingerprint(first), fingerprint(changed));
  for (const asset of [first, second, reordered, changed]) asset.dispose();
});

test('valid shape extremes stay closed and preserve specified dimensions at every LOD', () => {
  for (const value of [0, 1]) {
    for (const dimensions of [
      { width: 0.01, height: 0.01, depth: 0.01 },
      { width: 200, height: 0.01, depth: 25 },
    ]) {
      const asset = generateRock(
        createRockDefinition('boulder', {
          ...dimensions,
          roundness: value,
          angularity: 1 - value,
          asymmetry: 1,
          flattening: 1,
          displacement: 1,
          frequency: 12,
          variation: 1,
        }),
      );
      for (const group of asset.lods) {
        const geometry = group.children[0].geometry;
        verifyClosed(geometry);
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        assert.ok(Math.abs(size.x - dimensions.width) < 0.0001);
        assert.ok(Math.abs(size.y - dimensions.height) < 0.0001);
        assert.ok(Math.abs(size.z - dimensions.depth) < 0.0001);
      }
      asset.dispose();
    }
  }
});

test('invalid presets fail with actionable validation errors', () => {
  for (const invalid of [
    { height: 0 },
    { width: NaN },
    { seed: -1 },
    { version: 2 },
    { archetype: 'mountain' },
    { frequency: Infinity },
    { color: 'red' },
    { count: 0 },
    { colliderMode: 'mesh' },
  ]) {
    assert.throws(
      () => generateRock({ ...createRockDefinition(), ...invalid }),
      /Rock |Unknown rock |Unsupported rock /,
    );
  }
  assert.throws(
    () => generateRock(createRockDefinition(), { quality: 'ultra' }),
    /quality/,
  );
});

test('cluster member geometry is shared, deterministic, spaced and bounded', () => {
  const definition = createRockDefinition('cluster', {
    count: 36,
    spacing: 0.35,
  });
  const first = generateRock(definition);
  const second = generateRock(definition);
  assert.deepEqual(fingerprint(first), fingerprint(second));
  assert.equal(first.placement.placed, definition.count);
  for (const group of first.lods) {
    assert.ok(new Set(group.children.map((mesh) => mesh.geometry)).size <= 4);
    for (let i = 0; i < group.children.length; i++) {
      const mesh = group.children[i];
      assert.ok(
        Math.hypot(mesh.position.x, mesh.position.z) <= definition.radius,
      );
      for (let j = 0; j < i; j++)
        assert.ok(
          mesh.position.distanceTo(group.children[j].position) >=
            definition.spacing,
        );
    }
  }
  const crowded = generateRock(
    createRockDefinition('cluster', { radius: 0.01, spacing: 20, count: 128 }),
  );
  assert.equal(crowded.placement.placed, 1);
  assert.equal(crowded.placement.shortfall, 127);
  for (const asset of [first, second, crowded]) asset.dispose();
});

test('all shared geometries and materials are disposed exactly once', () => {
  const asset = generateRock(createRockDefinition('cluster'));
  const resources = new Set();
  for (const group of asset.lods)
    group.traverse((object) => {
      if (!object.isMesh) return;
      resources.add(object.geometry);
      resources.add(object.material);
    });
  const events = new Map();
  for (const resource of resources)
    resource.addEventListener('dispose', () =>
      events.set(resource, (events.get(resource) ?? 0) + 1),
    );
  asset.dispose();
  asset.dispose();
  for (const resource of resources) assert.equal(events.get(resource), 1);
});

test('cluster ObjectLoader round trip preserves distinct member transforms', () => {
  const asset = generateRock(createRockDefinition('cluster'));
  for (const group of asset.lods) {
    const restored = new THREE.ObjectLoader().parse(group.toJSON());
    assert.deepEqual(
      restored.children.map((mesh) => mesh.position.toArray()),
      group.children.map((mesh) => mesh.position.toArray()),
    );
    assert.ok(
      new Set(
        restored.children.map((mesh) => mesh.position.toArray().join(',')),
      ).size > 1,
    );
    restored.children.forEach((mesh, index) =>
      assert.ok(mesh.scale.distanceTo(group.children[index].scale) < 1e-12),
    );
    const geometries = new Set(),
      materials = new Set();
    restored.traverse((mesh) => {
      if (mesh.isMesh) {
        geometries.add(mesh.geometry);
        materials.add(mesh.material);
      }
    });
    geometries.forEach((resource) => resource.dispose());
    materials.forEach((resource) => resource.dispose());
  }
  asset.dispose();
});

test('cluster mix recipes select distinct reusable pebble, rock and boulder forms', () => {
  for (const mix of ['pebbles', 'mixed', 'outcrop']) {
    const asset = generateRock(
      createRockDefinition('cluster', { clusterMix: mix, count: 48 }),
    );
    const geometries = new Set(
      asset.object3D.children.map((mesh) => mesh.geometry),
    );
    const forms = new Set(
      [...geometries].map((geometry) => geometry.userData.archetype),
    );
    assert.equal(geometries.size, 4);
    if (mix === 'pebbles') assert.deepEqual([...forms], ['pebble']);
    if (mix === 'mixed')
      for (const form of ['pebble', 'rock', 'boulder'])
        assert.ok(forms.has(form));
    if (mix === 'outcrop') {
      assert.ok(forms.has('boulder'));
      assert.ok(!forms.has('pebble'));
    }
    asset.dispose();
  }
});

test('box, sphere and convex collider metadata encloses rock vertices', () => {
  assert.equal(
    generateRock(createRockDefinition('pebble')).collider.mode,
    'none',
  );
  for (const mode of ['box', 'sphere', 'convex']) {
    const asset = generateRock(
      createRockDefinition('boulder', { colliderMode: mode }),
    );
    const collider = asset.collider;
    assert.equal(collider.mode, mode);
    if (mode === 'box') {
      assert.ok(Math.abs(collider.size[0] - asset.definition.width) < 1e-5);
      assert.ok(
        Math.abs(collider.center[1] - asset.definition.height / 2) < 1e-5,
      );
    } else if (mode === 'sphere') {
      const center = new THREE.Vector3(...collider.center);
      const position = asset.object3D.children[0].geometry.attributes.position;
      for (let i = 0; i < position.count; i++)
        assert.ok(
          new THREE.Vector3()
            .fromBufferAttribute(position, i)
            .distanceTo(center) <=
            collider.radius + 1e-5,
        );
    } else {
      assert.ok(collider.vertices.length > 0);
      assert.ok(collider.indices.length > 0);
      assert.ok(
        collider.indices.length / 3 <= 80,
        'Convex proxy fits Unity collider face limits',
      );
      assert.ok(collider.vertices.every(Number.isFinite));
      const points = asset.object3D.children[0].geometry.attributes.position;
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3(),
        normal = new THREE.Vector3(),
        point = new THREE.Vector3();
      for (let i = 0; i < collider.vertices.length; i += 9) {
        a.fromArray(collider.vertices, i);
        b.fromArray(collider.vertices, i + 3);
        c.fromArray(collider.vertices, i + 6);
        normal.crossVectors(b.sub(a), c.sub(a)).normalize();
        for (let p = 0; p < points.count; p++)
          assert.ok(
            normal.dot(point.fromBufferAttribute(points, p).sub(a)) <= 1e-4,
            'Convex face contains source',
          );
      }
    }
    asset.dispose();
  }
});

test('standard preview generation remains below the 150 ms budget after warmup', () => {
  for (let i = 0; i < 5; i++)
    generateRock(createRockDefinition(), { quality: 'preview' }).dispose();
  const elapsed = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const asset = generateRock(createRockDefinition('rock', { seed: i }), {
      quality: 'preview',
    });
    elapsed.push(performance.now() - start);
    asset.dispose();
  }
  elapsed.sort((a, b) => a - b);
  assert.ok(elapsed[18] < 150, `Preview p95 ${elapsed[18].toFixed(2)} ms`);
});
