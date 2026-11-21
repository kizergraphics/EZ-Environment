import * as THREE from 'three';
import { MEADOW } from './biomes.js';
import { loadSurfaceMaps } from '../materials/surface-maps.js';

export class BiomeMaterials {
  constructor() {
    this.cache = new Map();
    this.hasImageLoader = typeof document !== 'undefined';
  }

  async surface(id, size) {
    if (!this.hasImageLoader) return null;
    const base = `/textures/biomes/${id}`;
    const key = `${id}/${size}`;
    const { map, normalMap, roughnessMap } = await loadSurfaceMaps(key, [
      `${base}/color-${size}.jpg`,
      `${base}/normal-${size}.png`,
      `${base}/roughness-${size}.png`,
    ], { cache: this.cache });
    return { color: map, normal: normalMap, roughness: roughnessMap };
  }

  async prepare(options) {
    const size = options.appearance === 'photorealistic' && options.quality !== 'low' ? 2048 : 1024;
    const [ground, stone] = await Promise.all([
      this.surface(MEADOW.surface, size),
      this.surface('weathered-rock', size),
    ]);
    return { ground, stone };
  }

  ground(options, maps) {
    const surface = maps?.ground;
    if (!surface && this.hasImageLoader) throw new Error('Terrain PBR textures are not ready.');
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    material.name = 'Terrain PBR';
    if (surface) {
      material.map = surface.color;
      material.normalMap = surface.normal;
      material.roughnessMap = surface.roughness;
    }
    material.normalScale.setScalar(options.appearance === 'photorealistic' ? .7 : .3);
    return material;
  }

  dispose() {
    for (const maps of this.cache.values()) {
      for (const texture of Object.values(maps)) texture.dispose();
    }
    this.cache.clear();
  }
}

export function disposeTerrainGround(ground) {
  if (!ground) return;
  ground.geometry.dispose();
  ground.material.dispose();
}
