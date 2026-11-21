import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { strFromU8 } from 'three/addons/libs/fflate.module.js';
import { Tree } from '../build/ez-tree.es.js';
import { createTreeLODAsset } from '../src/app/generators/tree-lods.js';
import { treeHeight, validateTreeHeight } from '../src/app/generators/tree-height.js';
import { triangleCount, triangleSimplifierReady } from '../src/app/generators/triangle-targets.js';
import {
  exportScenePack,
  validateManifest,
} from '../src/app/export/exporters.js';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
};

function trees() {
  const result = [];
  for (let index = 0; index < 3; index++) {
    const tree = new Tree();
    tree.options.branch.children = { 0: 2, 1: 2, 2: 2 };
    tree.options.branch.levels = 2;
    tree.options.seed = index === 2 ? 334 : 123;
    tree.generateLODs();
    tree.position.set(index * 130, index, index * -72);
    tree.rotation.set(0.08, index * 0.4, -0.07);
    tree.scale.setScalar(0.8 + index * 0.2);
    tree.lod.levels.forEach((level) => (level.object.visible = true));
    result.push(tree);
  }
  return result;
}
function environment() {
  return {
    registry: new Map(),
    options: { version: 1, seed: 18427, chunkSize: 48 },
    placement: { hash: 'empty', chunks: new Map() },
    exportObjects: [],
  };
}
function disposeTree(tree) {
  const geometry = new Set(),
    materials = new Set();
  tree.traverse((o) => {
    if (o.isMesh) {
      geometry.add(o.geometry);
      materials.add(o.material);
    }
  });
  geometry.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

test('scene packs keep each tree’s triangle targets and report the generated LOD sizes', async () => {
  await triangleSimplifierReady;
  const source = trees();
  const [tree, sameDefinition] = source;
  tree.targetHeight = 18;
  tree.triangleTargets = [500, 200, 60];
  const fit = createTreeLODAsset(tree);
  try {
    const counts = fit.lods.map(triangleCount);
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2]);
    const { manifest, files } = await exportScenePack(environment(), [tree, sameDefinition], { download: false });
    assert.equal(manifest.assets.length, 2);
    const withTargets = manifest.assets.find(asset => JSON.parse(strFromU8(files[asset.preset])).triangleTargets);
    assert.deepEqual(withTargets.lods.map(lod => lod.triangles), counts);
    const preset = JSON.parse(strFromU8(files[withTargets.preset]));
    assert.deepEqual(preset.triangleTargets, tree.triangleTargets);
    assert.equal(preset.targetHeight, 18);
    const glb = files[withTargets.lods[0].file];
    const jsonLength = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    const gltf = JSON.parse(strFromU8(glb.subarray(20, 20 + jsonLength)));
    const tops = gltf.meshes.flatMap(mesh => mesh.primitives.map(primitive => gltf.accessors[primitive.attributes.POSITION].max[1]));
    assert.ok(Math.abs(Math.max(...tops) - 18) < .00001);
  } finally {
    fit.dispose();
    source.forEach(disposeTree);
  }
});

test('resizing redistributes the existing geometry without changing LOD topology or triangle budgets', async () => {
  await triangleSimplifierReady;
  const source = trees();
  const [tree] = source;
  tree.triangleTargets = [501, 201, 61];
  const baseline = createTreeLODAsset(tree);
  try {
    for (const height of [.2, 14, 90]) {
      tree.targetHeight = height;
      const asset = createTreeLODAsset(tree);
      try {
        const [bark, foliage] = asset.lods[0].children;
        assert.ok(Math.abs(treeHeight(bark.geometry, foliage.geometry) - height) < .00001);
        assert.ok(asset.lods.every((lod, i) => triangleCount(lod) <= tree.triangleTargets[i]));
        for (const [level, lod] of asset.lods.entries()) {
          for (const [part, mesh] of lod.children.entries()) {
            const { geometry } = mesh;
            const original = baseline.lods[level].children[part].geometry;
            assert.deepEqual(geometry.index.array, original.index.array);
            assert.deepEqual(geometry.attributes.uv.array, original.attributes.uv.array);
            assert.equal(geometry.getAttribute('leafAnchorY'), undefined);
            const position = geometry.attributes.position;
            const from = original.attributes.position;
            assert.ok(position.array.every(Number.isFinite));
            for (let i = 0; i < position.count; i++) {
              assert.equal(position.getX(i), from.getX(i));
              assert.equal(position.getZ(i), from.getZ(i));
            }
          }
        }
      } finally { asset.dispose(); }
    }
  } finally {
    baseline.dispose();
    source.forEach(disposeTree);
  }
});

test('optional tree height rejects invalid numbers from saved data', () => {
  assert.equal(validateTreeHeight(undefined), undefined);
  assert.equal(validateTreeHeight(12.5), 12.5);
  for (const height of [null, 0, -5, 1001, Infinity, '12.5']) {
    assert.throws(() => validateTreeHeight(height), /Tree height/);
  }
});

test('real trees export once per definition with explicit LODs and exact world transforms', async () => {
  const source = trees(),
    env = environment();
  env.exportObjects = [{ id: 'hero-tree', object: source[0] }];
  const forest = new THREE.Group();
  forest.position.set(10, 0, -4);
  forest.rotation.y = 0.2;
  source.forEach((tree) => forest.add(tree));
  forest.updateMatrixWorld(true);
  const before = source.map((tree) => ({
    geometry: tree.branchesMesh.geometry,
    material: tree.branchesMesh.material,
    leafMaterial: tree.leavesMesh.material,
    visibility: tree.lod.levels.map((level) => level.object.visible),
    children: [...tree.children],
  }));
  const resources = new Set();
  source.forEach((tree) =>
    tree.traverse((o) => {
      if (o.isMesh) {
        resources.add(o.geometry);
        resources.add(o.material);
      }
    }),
  );
  let sourceDisposals = 0;
  resources.forEach((resource) =>
    resource.addEventListener('dispose', () => sourceDisposals++),
  );
  const generated = [];
  for (const tree of source) {
    const original = tree.createGeometry.bind(tree);
    tree.createGeometry = (detail) => {
      const result = original(detail);
      for (const geometry of Object.values(result)) {
        const tracked = { geometry, disposals: 0 };
        geometry.addEventListener('dispose', () => tracked.disposals++);
        generated.push(tracked);
      }
      return result;
    };
  }
  const pack = await exportScenePack(env, source, {
    download: false,
    treeColliders: true,
  });
  assert.equal(pack.manifest.assets.length, 2);
  assert.equal(pack.manifest.staticObjects.length, 0);
  assert.equal(pack.manifest.options.forest.count, 3);
  assert.ok(validateManifest(pack.manifest, pack.files).valid);
  assert.equal(env.registry.size, 0);
  assert.equal(env.placement.chunks.size, 0);
  assert.equal(generated.length, 12);
  assert.ok(generated.every((resource) => resource.disposals === 1));
  assert.equal(sourceDisposals, 0);
  const records = pack.manifest.chunks.flatMap((chunk) =>
    JSON.parse(strFromU8(pack.files[chunk.file])).layers.flatMap(
      (layer) => layer.instances,
    ),
  );
  assert.equal(records.length, 3);
  for (let index = 0; index < source.length; index++) {
    const tree = source[index],
      position = new THREE.Vector3(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    tree.matrixWorld.decompose(position, rotation, scale);
    const record = records.find(
      (record) =>
        new THREE.Vector3(...record.position).distanceTo(position) < 1e-9,
    );
    assert.ok(record);
    assert.deepEqual(record.rotation, rotation.toArray());
    assert.deepEqual(record.scale, scale.toArray());
    assert.equal(tree.branchesMesh.geometry, before[index].geometry);
    assert.equal(tree.branchesMesh.material, before[index].material);
    assert.equal(tree.leavesMesh.material, before[index].leafMaterial);
    assert.deepEqual(
      tree.lod.levels.map((level) => level.object.visible),
      before[index].visibility,
    );
    assert.deepEqual(tree.children, before[index].children);
  }
  for (const asset of pack.manifest.assets) {
    assert.equal(asset.lods.length, 3);
    assert.equal(asset.collider.mode, 'box');
    assert.deepEqual(asset.wind, { enabled: true, attribute: null });
    const definition = JSON.parse(strFromU8(pack.files[asset.preset]));
    assert.equal(definition.archetype, 'tree');
    assert.equal(definition.bark.maps, undefined);
    assert.equal(definition.leaves.map, undefined);
    const counts = [];
    for (const lod of asset.lods) {
      const bytes = pack.files[lod.file];
      const imported = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        '',
      );
      let meshes = 0,
        triangles = 0;
      imported.scene.traverse((o) => {
        if (o.isMesh) {
          meshes++;
          triangles +=
            (o.geometry.index?.count ?? o.geometry.attributes.position.count) /
            3;
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      assert.equal(meshes, 2, 'A GLB contains exactly one bark+leaf LOD');
      assert.equal(triangles, lod.triangles);
      counts.push(triangles);
    }
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2]);
  }
  source.forEach(disposeTree);
});

test('cancelled scene exports release export geometry without disposing source materials', async () => {
  const source = trees(),
    controller = new AbortController();
  let generated = 0,
    disposed = 0,
    materialDisposals = 0;
  for (const tree of source) {
    tree.branchesMesh.material.addEventListener(
      'dispose',
      () => materialDisposals++,
    );
    tree.leavesMesh.material.addEventListener(
      'dispose',
      () => materialDisposals++,
    );
    const original = tree.createGeometry.bind(tree);
    tree.createGeometry = (detail) => {
      const result = original(detail);
      Object.values(result).forEach((geometry) => {
        generated++;
        geometry.addEventListener('dispose', () => disposed++);
      });
      return result;
    };
  }
  await assert.rejects(
    exportScenePack(environment(), source, {
      download: false,
      signal: controller.signal,
      onProgress() {
        controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.ok(generated > 0);
  assert.equal(disposed, generated);
  assert.equal(materialDisposals, 0);
  source.forEach(disposeTree);
});
