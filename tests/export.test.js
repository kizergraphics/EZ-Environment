import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  unzipSync,
  strFromU8,
  strToU8,
} from 'three/addons/libs/fflate.module.js';
import {
  createRockDefinition,
  generateRock as generateTexturedRock,
} from '../src/app/generators/rocks.js';
import { extraSpecies as texturedExtraSpecies } from '../src/app/environment/biome-species.js';
import {
  createEnvironmentManifest,
  exportGLB,
  exportAssetPack,
  exportEnvironmentPack,
  placementTransform,
  validateManifest,
} from '../src/app/export/exporters.js';

// These DOM-free tests exercise geometry, manifests and transforms. Actual
// generated PBR map embedding is covered by export-pbr-fixture.mjs in a browser.
function geometryOnly(asset) {
  for (const variant of asset.variants ?? [asset])
    for (const root of variant.lods) root.traverse(node => {
      if (node.material) delete node.material.userData.pbrFamily;
    });
  return asset;
}
const generateRock = definition => geometryOnly(generateTexturedRock(definition));
const extraSpecies = kind => geometryOnly(texturedExtraSpecies(kind));

// GLTFExporter uses the browser FileReader API even for texture-free geometry.
// Node's Blob implementation supplies the same byte source for these tests.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(
      (value) => {
        this.result = value;
        this.onloadend?.();
      },
      (error) => this.onerror?.(error),
    );
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(
      (value) => {
        this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;
        this.onloadend?.();
      },
      (error) => this.onerror?.(error),
    );
  }
};

function fixture() {
  const rock = generateRock(
    createRockDefinition('rock', { colliderMode: 'convex' }),
  );
  const pebble = generateRock(createRockDefinition('pebble'));
  const normal = new THREE.Vector3(0.1, 1, 0.2).normalize().toArray();
  const record = {
    species: 'rock',
    position: [4, 1, -9],
    normal,
    yaw: 1.37,
    scale: [1.1, 0.7, 1.4],
    tint: 0.92,
    variationSeed: 3834,
  };
  return {
    registry: new Map([
      ['rock', rock],
      ['pebble', pebble],
    ]),
    options: { version: 1, seed: 18427 },
    placement: {
      hash: 'example-hash',
      chunks: new Map([
        [
          '0:-1',
          {
            x: 0,
            z: -1,
            layers: {
              rocks: { records: [record] },
              pebbles: {
                records: [
                  {
                    ...record,
                    species: 'pebble',
                    position: [5, 0, -3],
                    variationSeed: 22,
                  },
                ],
              },
            },
          },
        ],
      ]),
    },
    dispose() {
      rock.dispose();
      pebble.dispose();
    },
  };
}

test('biome appearance metadata is detached and discloses viewport effects omitted from packs', async () => {
  const environment=fixture();
  environment.options={...environment.options,biome:'desert',appearance:'photorealistic',lighting:{sky:'#80a7bb',exposure:1.05}};
  const manifest=createEnvironmentManifest(environment);
  assert.equal(manifest.presentation.appearance,'photorealistic');
  assert.equal(manifest.presentation.biome,'desert');
  assert.doesNotMatch(manifest.presentation.limitations.join(' '),/terrain material blending|procedural source-asset LODs/);
  assert.match(manifest.presentation.materialFallback,/embedded base color, normal, and roughness/);
  assert.match(manifest.presentation.limitations.join(' '),/ambient occlusion/);
  environment.options.lighting.exposure=2;
  assert.equal(manifest.presentation.lighting.exposure,1.05);
  const pack=await exportEnvironmentPack(environment,{download:false});
  assert.match(strFromU8(pack.files['README.txt']),/visual parity is not guaranteed/);
  assert.ok(validateManifest(pack.manifest,pack.files).valid);environment.dispose();
});

test('cactus and fallen wood export three standard-material LODs without vegetation wind', async () => {
  for(const id of ['cactus','fallen_log']){
    const asset=extraSpecies(id);
    try{
      const pack=await exportAssetPack(asset,id,{download:false}),descriptor=pack.manifest.assets[0];
      assert.equal(descriptor.lods.length,3);assert.equal(descriptor.wind.enabled,false);
      assert.ok(validateManifest(pack.manifest,pack.files).valid);
      assert.equal(JSON.parse(strFromU8(pack.files[descriptor.preset])).archetype,id);
      for(const lod of descriptor.lods){
        const bytes=pack.files[lod.file],view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        const data=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))).trim());
        assert.ok(data.materials.every(material=>material.pbrMetallicRoughness));
      }
    }finally{asset.dispose();}
  }
});

test('static biome grove export preserves all highest-detail instances independently of viewport LOD counts', async () => {
  const environment=fixture(),source=environment.registry.get('rock').lods[0].children[0];
  const grove=new THREE.Group(),mesh=new THREE.InstancedMesh(source.geometry,source.material,3);
  for(let i=0;i<3;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*10,0,-i*5));
  grove.add(mesh);environment.exportObjects=[{id:'biome-trees',object:grove}];
  const pack=await exportEnvironmentPack(environment,{download:false});
  assert.ok(validateManifest(pack.manifest,pack.files).valid);
  const bytes=pack.files['static/biome-trees.glb'];assert.ok(bytes);
  const imported=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  let count=0;imported.traverse(object=>{if(object.isInstancedMesh)count+=object.count;});assert.equal(count,3);
  assert.equal(mesh.count,3,'export must not mutate the source instance count');
  imported.traverse(object=>{if(object.isMesh){object.geometry.dispose();object.material.dispose();object.dispose?.();}});
  mesh.dispose();environment.dispose();
});

test('placement export matches viewport matrix and Unity X reflection', () => {
  const record = {
    position: [3, 2, -4],
    normal: new THREE.Vector3(0.3, 1, -0.2).normalize().toArray(),
    yaw: 0.8,
    scale: [1.2, 0.9, 1.5],
  };
  const result = placementTransform(record),
    up = new THREE.Vector3(0, 1, 0);
  const expected = new THREE.Object3D();
  expected.position.fromArray(record.position);
  expected.scale.fromArray(record.scale);
  expected.quaternion
    .setFromUnitVectors(up, new THREE.Vector3(...record.normal))
    .multiply(new THREE.Quaternion().setFromAxisAngle(up, record.yaw));
  expected.updateMatrix();
  const actual = new THREE.Matrix4().compose(
    new THREE.Vector3(...result.position),
    new THREE.Quaternion(...result.rotation),
    new THREE.Vector3(...result.scale),
  );
  assert.deepEqual(actual.toArray(), expected.matrix.toArray());
  const reflect = new THREE.Matrix4().makeScale(-1, 1, 1);
  const converted = reflect.clone().multiply(actual).multiply(reflect);
  const unity = new THREE.Matrix4().compose(
    new THREE.Vector3(
      -result.position[0],
      result.position[1],
      result.position[2],
    ),
    new THREE.Quaternion(
      result.rotation[0],
      -result.rotation[1],
      -result.rotation[2],
      result.rotation[3],
    ),
    new THREE.Vector3(...result.scale),
  );
  unity
    .toArray()
    .forEach((n, i) => assert.ok(Math.abs(n - converted.elements[i]) < 1e-12));
  assert.throws(
    () => placementTransform({ ...record, normal: [0, 0, 0] }),
    /normal/,
  );
});

test('real binary GLB round trip retains rock bounds, triangle count and material', async () => {
  const asset = generateRock(createRockDefinition('boulder'));
  const buffer = await exportGLB(asset.object3D);
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(8, true), buffer.byteLength);
  const imported = await new GLTFLoader().parseAsync(buffer, '');
  const bounds = new THREE.Box3().setFromObject(imported.scene);
  const original = new THREE.Box3().setFromObject(asset.object3D);
  assert.deepEqual(bounds.min.toArray(), original.min.toArray());
  assert.deepEqual(bounds.max.toArray(), original.max.toArray());
  let triangles = 0;
  imported.scene.traverse((o) => {
    if (o.isMesh) {
      triangles += o.geometry.index.count / 3;
      assert.equal(o.material.roughness, asset.definition.roughness);
      assert.equal(o.material.metalness, 0);
      assert.ok(o.geometry.attributes.color);
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  assert.equal(triangles, 1280);
  asset.dispose();
});

test('asset ZIP contains three independently importable LODs and a round-trip preset', async () => {
  const asset = generateRock(createRockDefinition('rock'));
  const pack = await exportAssetPack(asset, 'Field Rock', { download: false });
  const files = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
  assert.deepEqual(
    JSON.parse(strFromU8(files['preset.json'])),
    asset.definition,
  );
  assert.ok(
    validateManifest(JSON.parse(strFromU8(files['manifest.json'])), files)
      .valid,
  );
  for (let level = 0; level < 3; level++) {
    const data = files[`lod${level}.glb`];
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      '',
    );
    assert.ok(gltf.scene.getObjectByName(`lod${level}`));
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
  asset.dispose();
});

test('environment export snapshots deterministic placements and validates every referenced file', async () => {
  const environment = fixture();
  const first = createEnvironmentManifest(environment);
  environment.registry = new Map([...environment.registry.entries()].reverse());
  assert.deepEqual(first, createEnvironmentManifest(environment));
  const pack = await exportEnvironmentPack(environment, { download: false });
  const data = JSON.parse(strFromU8(pack.files['chunks/chunk_0_-1.json']));
  assert.equal(
    data.layers.reduce((sum, l) => sum + l.instances.length, 0),
    2,
  );
  assert.equal(pack.manifest.placementHash, 'example-hash');
  assert.ok(validateManifest(pack.manifest, pack.files).valid);
  const expected = placementTransform(
    environment.placement.chunks.get('0:-1').layers.rocks.records[0],
  );
  assert.deepEqual(
    data.layers.find((l) => l.name === 'rocks').instances[0].rotation,
    expected.rotation,
  );
  assert.deepEqual(
    pack.manifest.assets.find((a) => a.id === 'rock').collider,
    environment.registry.get('rock').collider,
  );
  const missing = { ...pack.files };
  delete missing['assets/rock/lod1.glb'];
  assert.ok(
    validateManifest(pack.manifest, missing).errors.some((e) =>
      e.includes('Missing file'),
    ),
  );
  const corrupt = structuredClone(pack.manifest);
  corrupt.assets[0].lods[0].file = '../escape.glb';
  assert.ok(
    validateManifest(corrupt, pack.files).errors.some((e) =>
      e.includes('Unsafe'),
    ),
  );
  const changed = { ...pack.files };
  data.layers[0].instances[0].asset = 'missing';
  changed['chunks/chunk_0_-1.json'] = strToU8(JSON.stringify(data));
  assert.ok(
    validateManifest(pack.manifest, changed).errors.some((e) =>
      e.includes('missing asset'),
    ),
  );
  environment.dispose();
});

test('rock variation seeds expand to matching ephemeral manifest-v1 asset aliases', async () => {
  const rock=geometryOnly(generateTexturedRock(createRockDefinition('rock',{seed:44}),{variants:true}));
  const records=[0,1,5].map((variationSeed,index)=>({
    species:'rock',position:[index*2,0,0],normal:[0,1,0],yaw:0,
    scale:[1,1,1],tint:1,variationSeed,
  }));
  const environment={
    registry:new Map([['rock',rock]]),options:{version:1,seed:1},
    placement:{hash:'variants',chunks:new Map([['0:0',{x:0,z:0,layers:{rocks:{records}}}]])},
  };
  try{
    const manifest=createEnvironmentManifest(environment);
    assert.equal(manifest.version,1);
    assert.deepEqual(manifest.assets.map(asset=>asset.id),['rock__v1','rock__v2','rock__v3']);
    const pack=await exportEnvironmentPack(environment,{download:false,includeInstancedScene:true,includeBakedChunks:true});
    const chunk=JSON.parse(strFromU8(pack.files['chunks/chunk_0_0.json']));
    assert.deepEqual(chunk.layers[0].instances.map(record=>record.asset),['rock__v1','rock__v2','rock__v3']);
    assert.ok(pack.files['assets/rock__v2/lod0.glb']);
    assert.ok(validateManifest(pack.manifest,pack.files).valid);
  }finally{rock.dispose();}
});

test('terrain and authored static objects are packaged alongside scatter data', async () => {
  const environment = fixture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x336633 }),
  );
  ground.rotation.x = -Math.PI / 2;
  environment.ground = ground;
  environment.exportObjects = [
    { id: 'tree', object: environment.registry.get('rock').object3D },
  ];
  const pack = await exportEnvironmentPack(environment, { download: false });
  assert.ok(pack.files['terrain.glb']);
  assert.ok(pack.files['static/tree.glb']);
  assert.ok(validateManifest(pack.manifest, pack.files).valid);
  ground.geometry.dispose();
  ground.material.dispose();
  environment.dispose();
});

test('cancellation prevents packaging after completed partial GLBs', async () => {
  const asset = generateRock(createRockDefinition());
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    exportAssetPack(asset, 'rock', { download: false, signal: aborted.signal }),
    { name: 'AbortError' },
  );
  const during = new AbortController();
  let completed = 0;
  await assert.rejects(
    exportAssetPack(asset, 'rock', {
      download: false,
      signal: during.signal,
      onProgress() {
        completed++;
        during.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(completed, 1);
  asset.dispose();
});

test('optional instanced scene and baked chunks preserve world bounds and tint', async () => {
  const environment = fixture();
  const pack = await exportEnvironmentPack(environment, {
    download: false,
    includeInstancedScene: true,
    includeBakedChunks: true,
  });
  assert.equal(pack.manifest.additionalExports.length, 2);
  assert.ok(validateManifest(pack.manifest, pack.files).valid);
  const imported = [];
  for (const path of ['scene.instanced.glb', 'baked/chunk_0_-1.glb']) {
    const bytes = pack.files[path];
    imported.push(
      (
        await new GLTFLoader().parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          '',
        )
      ).scene,
    );
  }
  const bounds = imported.map((root) => {
    const box = new THREE.Box3(),
      matrix = new THREE.Matrix4(),
      point = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!object.isMesh) return;
      for (
        let instance = 0;
        instance < (object.isInstancedMesh ? object.count : 1);
        instance++
      ) {
        if (object.isInstancedMesh) {
          object.getMatrixAt(instance, matrix);
          matrix.premultiply(object.matrixWorld);
        } else matrix.copy(object.matrixWorld);
        const position = object.geometry.attributes.position;
        for (let vertex = 0; vertex < position.count; vertex++)
          box.expandByPoint(
            point.fromBufferAttribute(position, vertex).applyMatrix4(matrix),
          );
      }
    });
    return box;
  });
  assert.ok(bounds[0].min.distanceTo(bounds[1].min) < 1e-5);
  assert.ok(bounds[0].max.distanceTo(bounds[1].max) < 1e-5);
  let instances = 0,
    bakedMeshes = 0;
  imported[0].traverse((object) => {
    if (object.isInstancedMesh) {
      instances += object.count;
      assert.ok(object.instanceColor);
    }
  });
  imported[1].traverse((object) => {
    if (object.isMesh) {
      bakedMeshes++;
      assert.ok(!object.isInstancedMesh);
      assert.ok(object.geometry.attributes.color);
    }
  });
  assert.equal(instances, 2);
  assert.equal(bakedMeshes, 2);
  for (const scene of imported)
    scene.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();
        object.material.dispose();
        object.dispose?.();
      }
    });
  environment.dispose();
});
