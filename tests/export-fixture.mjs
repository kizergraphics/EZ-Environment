// Generates binary integration fixtures for a real Unity Editor import.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import {
  createRockDefinition,
  generateRock,
} from '../src/app/generators/rocks.js';
import {
  createPlantDefinition,
  generatePlant,
} from '../src/app/generators/plants.js';
import { exportEnvironmentPack } from '../src/app/export/exporters.js';
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
};
const destination = path.resolve(process.argv[2] ?? 'unity-validation/Fixture');
const registry = new Map();
for (const archetype of ['shrub', 'fern', 'flower'])
  registry.set(archetype, generatePlant(createPlantDefinition(archetype)));
for (const archetype of ['rock', 'boulder', 'pebble'])
  registry.set(
    archetype,
    generateRock(
      createRockDefinition(archetype, {
        colliderMode:
          archetype === 'boulder'
            ? 'convex'
            : archetype === 'rock'
              ? 'sphere'
              : 'none',
      }),
    ),
  );
const normal = new THREE.Vector3(0.12, 1, 0.2).normalize().toArray();
const layers = {};
let index = 0;
for (const [id] of registry) {
  layers[id] = {
    records: [0, 1].map((i) => ({
      species: id,
      position: [index * 3 - 7, 0, i * 4 - 2],
      normal,
      yaw: 0.3 + index * 0.3,
      scale: [0.8, 0.8, 0.8],
      tint: 0.85 + i * 0.15,
      variationSeed: index * 2 + i,
    })),
  };
  index++;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 20, 10, 10),
  new THREE.MeshStandardMaterial({ color: '#556343', roughness: 1 }),
);
ground.geometry.rotateX(-Math.PI / 2);
ground.name = 'Terrain';
ground.position.y = -0.2;
const environment = {
  registry,
  ground,
  options: { version: 1, seed: 18427 },
  placement: {
    hash: 'unity-validation-v1',
    chunks: new Map([['0:0', { x: 0, z: 0, layers }]]),
  },
};
const pack = await exportEnvironmentPack(environment, { download: false });
for (const [relative, data] of Object.entries(pack.files)) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}
await writeFile(
  path.join(destination, 'fixture.zip'),
  new Uint8Array(await pack.blob.arrayBuffer()),
);
for (const asset of registry.values()) asset.dispose();
ground.geometry.dispose();
ground.material.dispose();
console.log(
  JSON.stringify({
    destination,
    assets: pack.manifest.assets.length,
    instances: 12,
    files: Object.keys(pack.files).length,
  }),
);
