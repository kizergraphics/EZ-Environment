import * as THREE from 'three';
import { registerTextureReadiness, textureReadiness } from '../materials/readiness.js';

/** A pack owns its appearance and hierarchy, but never the source geometry. */
export function createExportSnapshot() {
  const materials = new Map(),
    textures = new Map(),
    instances = new Set();
  let disposed = false;
  const jpeg = (texture) =>
    /\.jpe?g(?:[?#]|$)/i.test(
      texture.image?.currentSrc || texture.image?.src || '',
    );
  function copyTexture(source, preserveJPEG) {
    let formats = textures.get(source);
    if (!formats) textures.set(source, (formats = new Map()));
    const mimeType = preserveJPEG && jpeg(source) ? 'image/jpeg' : null;
    if (formats.has(mimeType)) return formats.get(mimeType);
    const texture = source.clone();
    // Texture.clone shares Source; separate that wrapper so replacing a live
    // map's image cannot change this export. Bundled HTML images are immutable.
    const image = source.image;
    texture.source = new THREE.Source(
      image?.data && ArrayBuffer.isView(image.data)
        ? { ...image, data: image.data.slice() }
        : image,
    );
    texture.userData = { ...texture.userData };
    const ready = textureReadiness(source);
    if (ready) registerTextureReadiness(texture, ready.then(() => {
      // Loader completion may replace an initially undefined image.
      if (!image) texture.image = source.image;
    }));
    if (mimeType) texture.userData.mimeType = mimeType;
    else if (texture.userData.mimeType === 'image/jpeg')
      delete texture.userData.mimeType;
    formats.set(mimeType, texture);
    return texture;
  }
  function copyMaterial(source) {
    if (materials.has(source)) return materials.get(source);
    // Tree shader caches contain renderer-owned objects and must not enter
    // Material.copy's JSON serialization or the portable material extras.
    const userData = { ...source.userData };
    delete userData.shader;
    const proxy = Object.assign(
      Object.create(Object.getPrototypeOf(source)),
      source,
      { userData },
    );
    const material = new source.constructor().copy(proxy);
    materials.set(source, material);
    for (const [key, value] of Object.entries(source))
      if (value?.isTexture) {
        // Retain JPEG only for originally JPEG images. Alpha color and derived
        // metallic/roughness channel maps remain PNG in GLTFExporter.
        const preserveJPEG =
          ['normalMap', 'aoMap', 'emissiveMap'].includes(key) ||
          (key === 'map' && !source.transparent && !(source.alphaTest > 0));
        material[key] = copyTexture(value, preserveJPEG);
      }
    return material;
  }
  function object(source) {
    if (disposed) throw new Error('Export snapshot has been disposed.');
    // Custom Tree constructors create children; never call Tree.clone here.
    const target =
      source.isMesh || source.isLine || source.isPoints
        ? source.clone(false)
        : new THREE.Group().copy(source, false);
    if (target.isInstancedMesh) instances.add(target);
    if (source.material)
      target.material = Array.isArray(source.material)
        ? source.material.map(copyMaterial)
        : copyMaterial(source.material);
    for (const child of source.children) target.add(object(child));
    return target;
  }
  return {
    object,
    asset(source) {
      const lods = (source.lods ?? [source.object3D ?? source]).map(object);
      return {
        lods,
        object3D: lods[0],
        definition:
          source.definition === undefined
            ? undefined
            : structuredClone(source.definition),
        definitionHash: source.definitionHash,
        collider: source.collider,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of instances) instance.dispose();
      for (const material of materials.values()) material.dispose();
      for (const formats of textures.values())
        for (const texture of formats.values()) texture.dispose();
      instances.clear();
      materials.clear();
      textures.clear();
    },
  };
}
