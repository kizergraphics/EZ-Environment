import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTerrainGeometry, terrainBlend, TERRAIN_TILE_SIZE } from '../src/app/environment/terrain.js';
import { BiomeMaterials, disposeTerrainGround } from '../src/app/environment/materials.js';
import { validateOptions } from '../src/app/environment/options.js';

const options = validateOptions({ composition: 'biome', biome: 'meadow', radius: 16 });

test('terrain uses continuous repeating world-space UVs and vertex colors', () => {
  const geometry = createTerrainGeometry(options);
  assert.equal(geometry.groups.length, 0);
  const { position, uv, color } = geometry.attributes;
  const tileSize = TERRAIN_TILE_SIZE;
  const seam = new Map();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    assert.equal(uv.getX(i), Math.fround(x / tileSize));
    assert.equal(uv.getY(i), Math.fround(z / tileSize));
    const tint = [color.getX(i), color.getY(i), color.getZ(i)];
    assert.ok(tint.every(channel => channel >= 0 && channel <= 1));
    const key = `${x},${z}`;
    if (seam.has(key)) assert.deepEqual(tint, seam.get(key));
    seam.set(key, tint);
  }
  assert.equal(terrainBlend(options.radius * 1.25, 0, options), 0);
  geometry.dispose();
});

test('terrain binds shared PBR maps and leaves them available after ground disposal', () => {
  const maps = { ground: { color: new THREE.Texture(), normal: new THREE.Texture(), roughness: new THREE.Texture() } };
  const material = new BiomeMaterials().ground(options, maps);
  const geometry = createTerrainGeometry(options);
  let mapDisposals = 0, materialDisposals = 0, geometryDisposals = 0;
  for (const texture of Object.values(maps.ground)) texture.addEventListener('dispose', () => mapDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  geometry.addEventListener('dispose', () => geometryDisposals++);
  assert.equal(material.map, maps.ground.color);
  assert.equal(material.normalMap, maps.ground.normal);
  assert.equal(material.roughnessMap, maps.ground.roughness);
  assert.ok(material.vertexColors);
  disposeTerrainGround(new THREE.Mesh(geometry, material));
  assert.deepEqual([mapDisposals, materialDisposals, geometryDisposals], [0, 1, 1]);
});
