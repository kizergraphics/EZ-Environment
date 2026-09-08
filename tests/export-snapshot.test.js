import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExportSnapshot } from '../src/app/export/snapshot.js';
import {
  exportAssetPack,
  exportEnvironmentPack,
  exportGLB,
} from '../src/app/export/exporters.js';
import { awaitTextureReadiness, registerTextureReadiness } from '../src/app/materials/readiness.js';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
};
function gltf(bytes) {
  const buffer = Buffer.from(bytes);
  return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)));
}
function asset(
  material = new THREE.MeshStandardMaterial({ color: '#456789' }),
) {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const lods = [0, 1, 2].map((level) => {
    const group = new THREE.Group();
    group.name = `lod${level}`;
    group.add(new THREE.Mesh(geometry, material));
    return group;
  });
  return {
    lods,
    object3D: lods[0],
    definition: { archetype: 'rock', seed: 4 },
    geometry,
    material,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

test('appearance snapshot owns independent shared materials, map settings and image sources', () => {
  const texture = new THREE.Texture({ src: 'bark.jpg' });
  texture.repeat.set(2, 3);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    normalMap: texture,
    roughnessMap: texture,
  });
  const shader = {};
  shader.circular = shader;
  material.userData.shader = shader;
  const alpha = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
  });
  const geometry = new THREE.BoxGeometry(),
    root = new THREE.Group();
  root.add(
    new THREE.Mesh(geometry, material),
    new THREE.Mesh(geometry, material),
    new THREE.InstancedMesh(geometry, alpha, 1),
  );
  const snapshot = createExportSnapshot(),
    copy = snapshot.object(root);
  const opaque = copy.children[0].material,
    masked = copy.children[2].material;
  assert.equal(opaque, copy.children[1].material);
  assert.notEqual(opaque, material);
  assert.equal(copy.children[0].geometry, geometry);
  assert.equal(opaque.userData.shader, undefined);
  assert.equal(material.userData.shader, shader);
  assert.equal(opaque.map, opaque.normalMap);
  assert.notEqual(opaque.map, opaque.roughnessMap);
  assert.equal(opaque.map.userData.mimeType, 'image/jpeg');
  assert.equal(opaque.roughnessMap.userData.mimeType, undefined);
  assert.equal(masked.map.userData.mimeType, undefined);
  assert.equal(masked.map, opaque.roughnessMap);
  const originalImage = texture.image;
  texture.repeat.set(8, 9);
  texture.image = { src: 'new.png' };
  material.opacity = 0.2;
  material.color.set('red');
  assert.deepEqual(opaque.map.repeat.toArray(), [2, 3]);
  assert.equal(opaque.map.image, originalImage);
  assert.equal(opaque.opacity, 1);
  assert.equal(opaque.color.getHex(), 0xffffff);
  const owned = new Set([
      opaque,
      masked,
      opaque.map,
      masked.map,
      copy.children[2],
    ]),
    counts = new Map();
  for (const resource of owned)
    resource.addEventListener('dispose', () =>
      counts.set(resource, (counts.get(resource) || 0) + 1),
    );
  let sourceDisposals = 0;
  for (const resource of [material, alpha, texture, geometry])
    resource.addEventListener('dispose', () => sourceDisposals++);
  snapshot.dispose();
  snapshot.dispose();
  assert.equal(sourceDisposals, 0);
  for (const resource of owned) assert.equal(counts.get(resource), 1);
  assert.throws(() => snapshot.object(root), /disposed/);
  geometry.dispose();
  material.dispose();
  alpha.dispose();
  texture.dispose();
  root.children[2].dispose();
});

test('asset pack keeps initial appearance and definition across asynchronous LOD exports', async () => {
  const source = asset(),
    color = [...source.material.color.toArray(), 1];
  const pack = await exportAssetPack(source, 'stable', {
    download: false,
    onProgress({ lod }) {
      if (lod === 0) {
        source.material.color.set('red');
        source.material.roughness = 0.1;
        source.definition.seed = 99;
        source.lods[1].position.x = 55;
      }
    },
  });
  for (let level = 0; level < 3; level++) {
    const json = gltf(pack.files[`lod${level}.glb`]);
    assert.deepEqual(
      json.materials[0].pbrMetallicRoughness.baseColorFactor,
      color,
    );
    assert.equal(json.materials[0].pbrMetallicRoughness.roughnessFactor, 1);
    assert.ok(
      json.nodes.every(
        (node) => !node.translation || node.translation[0] !== 55,
      ),
    );
  }
  assert.equal(
    JSON.parse(new TextDecoder().decode(pack.files['preset.json'])).seed,
    4,
  );
  assert.equal(source.definition.seed, 99);
  assert.equal(source.material.color.getHex(), 0xff0000);
  source.dispose();
});

test('environment pack snapshots later species and static object appearance before the first await', async () => {
  const a = asset(),
    b = asset(new THREE.MeshStandardMaterial({ color: '#238911' }));
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshStandardMaterial({ color: '#124875' }),
  );
  const record = (id) => ({
    species: id,
    position: [0, 0, 0],
    normal: [0, 1, 0],
    yaw: 0,
    scale: [1, 1, 1],
    tint: 1,
  });
  const environment = {
    registry: new Map([
      ['a', a],
      ['b', b],
    ]),
    ground: terrain,
    options: { version: 1, seed: 4 },
    placement: {
      chunks: new Map([
        [
          '0:0',
          {
            x: 0,
            z: 0,
            layers: { rocks: { records: [record('a'), record('b')] } },
          },
        ],
      ]),
    },
  };
  const bColor = [...b.material.color.toArray(), 1],
    terrainColor = [...terrain.material.color.toArray(), 1];
  const pack = await exportEnvironmentPack(environment, {
    download: false,
    onProgress() {
      b.material.color.set('red');
      terrain.material.color.set('red');
      terrain.position.x = 80;
      b.definition.seed = 100;
    },
  });
  for (const descriptor of pack.manifest.assets.filter(
    (entry) => entry.id === 'b',
  ))
    for (const lod of descriptor.lods)
      assert.deepEqual(
        gltf(pack.files[lod.file]).materials[0].pbrMetallicRoughness
          .baseColorFactor,
        bColor,
      );
  const terrainJSON = gltf(pack.files['terrain.glb']);
  assert.deepEqual(
    terrainJSON.materials[0].pbrMetallicRoughness.baseColorFactor,
    terrainColor,
  );
  assert.ok(
    terrainJSON.nodes.every(
      (node) => !node.translation || node.translation[0] !== 80,
    ),
  );
  assert.equal(
    JSON.parse(new TextDecoder().decode(pack.files['assets/b/preset.json']))
      .seed,
    4,
  );
  a.dispose();
  b.dispose();
  terrain.geometry.dispose();
  terrain.material.dispose();
});

test('appearance clones are disposed on successful, cancelled and failed pack exports without disposing live resources', async () => {
  for (const outcome of ['success', 'cancel', 'failure']) {
    const tracked = [];
    class TrackedMaterial extends THREE.MeshStandardMaterial {
      constructor() {
        super();
        const entry = { material: this, disposed: 0 };
        tracked.push(entry);
        this.addEventListener('dispose', () => entry.disposed++);
      }
    }
    const source = asset(new TrackedMaterial()),
      abort = new AbortController();
    const pending = exportAssetPack(source, 'lifecycle', {
      download: false,
      signal: abort.signal,
      onProgress() {
        if (outcome === 'cancel') abort.abort();
        if (outcome === 'failure') throw new Error('Injected failure');
      },
    });
    if (outcome === 'success') await pending;
    else
      await assert.rejects(
        pending,
        outcome === 'cancel' ? { name: 'AbortError' } : /Injected failure/,
      );
    assert.ok(tracked.length > 1);
    assert.equal(tracked[0].disposed, 0);
    for (const entry of tracked.slice(1)) assert.equal(entry.disposed, 1);
    source.dispose();
  }
});

test('wind metadata distinguishes actual weighted geometry from height-based vegetation', async () => {
  for (const [definition, weighted, enabled] of [
    [{ archetype: 'tree' }, false, true],
    [{ source: 'flower_white' }, false, true],
    [{ archetype: 'shrub' }, true, true],
    [{ archetype: 'rock' }, false, false],
  ]) {
    const source = asset();
    source.definition = definition;
    if (weighted)
      source.geometry.setAttribute(
        'windWeight',
        new THREE.Float32BufferAttribute(
          new Float32Array(source.geometry.attributes.position.count),
          1,
        ),
      );
    const pack = await exportAssetPack(source, 'wind', { download: false });
    assert.deepEqual(pack.manifest.assets[0].wind, {
      enabled,
      attribute: weighted ? '_WINDWEIGHT' : null,
    });
    for (const lod of pack.manifest.assets[0].lods) {
      const json = gltf(pack.files[lod.file]);
      assert.equal(
        json.meshes.some((mesh) =>
          mesh.primitives.some((p) => '_WINDWEIGHT' in p.attributes),
        ),
        weighted,
      );
    }
    source.dispose();
  }
});

test('photographic biome packs select the visible foliage for every LOD', async () => {
  const source = asset(), photo = asset(new THREE.MeshStandardMaterial({ color: '#88aa33', alphaTest: .45, side: THREE.DoubleSide }));
  source.photoLods = photo.lods;
  const environment = {
    registry: new Map([['shrub', source]]),
    options: { appearance: 'photorealistic', composition: 'biome' },
    placement: { chunks: new Map([['0:0', { x: 0, z: 0, layers: { plants: { records: [{ species: 'shrub', position: [0,0,0], normal: [0,1,0], yaw: 0, scale: [1,1,1] }] } } }]]) },
  };
  const pack = await exportEnvironmentPack(environment, { download: false, includeBakedChunks: true });
  for (const descriptor of pack.manifest.assets[0].lods) {
    const material = gltf(pack.files[descriptor.file]).materials[0];
    assert.equal(material.alphaMode, 'MASK');
    assert.equal(material.doubleSided, true);
    assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor, [...photo.material.color.toArray(), 1]);
  }
  source.dispose(); photo.dispose();
});

test('export fails with a useful error for missing attached textures', async () => {
  const texture = new THREE.Texture(), source = asset(new THREE.MeshStandardMaterial({ map: texture }));
  await assert.rejects(exportGLB(source.object3D), /Texture is not ready/);
  source.dispose(); texture.dispose();
});

test('snapshot waits for pending texture completion and cancels waiting without touching the source', async () => {
  const texture = new THREE.Texture(), source = asset(new THREE.MeshStandardMaterial({ map: texture }));
  let resolve;
  registerTextureReadiness(texture, new Promise(done => { resolve = done; }));
  const snapshot = createExportSnapshot(), copy = snapshot.object(source.object3D);
  const controller = new AbortController();
  const cancelled = awaitTextureReadiness(copy, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  texture.image = { width: 2, height: 2, data: new Uint8Array(16) };
  resolve();
  await awaitTextureReadiness(copy);
  assert.equal(copy.children[0].material.map.image, texture.image);
  snapshot.dispose(); source.dispose(); texture.dispose();
});
