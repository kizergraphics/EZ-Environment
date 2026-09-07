import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export function disposeObject(root, disposeTextures = false) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      materials.add(m);
      if (disposeTextures) for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}
export class EnvironmentAssetCache {
  constructor(loader = null) {
    this.entries = new Map(); this.disposed = false;
    if (loader) this.loader = loader;
    else {
      this.decoder = new DRACOLoader().setDecoderPath('/draco/');
      this.loader = new GLTFLoader().setDRACOLoader(this.decoder);
    }
  }
  load(path) {
    if (this.disposed) return Promise.reject(new Error('Asset cache is disposed.'));
    if (this.entries.has(path)) return this.entries.get(path);
    const promise = this.loader.loadAsync(path).then(gltf => {
      if (this.disposed) { disposeObject(gltf.scene, true); throw new Error('Asset loading canceled.'); }
      let count = 0;
      gltf.scene.traverse(o => { if (o.isMesh && o.geometry?.attributes.position && o.material) count++; });
      if (!count) { disposeObject(gltf.scene, true); throw new Error('No renderable meshes found.'); }
      return gltf.scene;
    }).catch(e => { this.entries.delete(path); throw new Error(`Could not load ${path}: ${e.message}`); });
    this.entries.set(path, promise); return promise;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.entries.values()) p.then(root => disposeObject(root, true)).catch(() => {});
    this.entries.clear(); this.decoder?.dispose();
  }
}
