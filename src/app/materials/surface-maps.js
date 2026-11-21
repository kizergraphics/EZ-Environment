import * as THREE from 'three';
import { registerTextureReadiness, textureReadiness } from './readiness.js';

const loader = new THREE.TextureLoader();
const shared = new Map();
const slots = ['map', 'normalMap', 'roughnessMap'];

export function companionMaps(colorPath, base = colorPath.slice(0, colorPath.lastIndexOf('.'))) {
  return [colorPath, `${base}-normal.png`, `${base}-roughness.png`];
}

export function getSurfaceMaps(name, paths, {
  wrap = THREE.RepeatWrapping, premultiplyAlpha = false, cache = shared,
} = {}) {
  if (cache.has(name)) return cache.get(name);

  const maps = {};
  for (const [index, slot] of slots.entries()) {
    const path = paths[index];
    let resolve, reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    const texture = loader.load(path, resolve, undefined, () => {
      if (cache.get(name) === maps) cache.delete(name);
      reject(new Error(`Could not load required texture ${path}. Retry generation.`));
    });
    registerTextureReadiness(texture, ready);
    texture.name = `${name} ${slot}`;
    texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = wrap;
    texture.anisotropy = 8;
    texture.premultiplyAlpha = index === 0 && premultiplyAlpha;
    maps[slot] = texture;
  }
  cache.set(name, maps);
  return maps;
}

export async function loadSurfaceMaps(name, paths, options) {
  const maps = getSurfaceMaps(name, paths, options);
  await Promise.all(Object.values(maps).map(textureReadiness));
  return maps;
}
