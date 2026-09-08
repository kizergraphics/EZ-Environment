const pending = new WeakMap();

export function registerTextureReadiness(texture, promise) {
  const ready = Promise.resolve(promise);
  // Loading failures are reported by export even if nobody exports immediately.
  ready.catch(() => {});
  pending.set(texture, ready);
  if (texture.source) pending.set(texture.source, ready);
  return texture;
}

export function textureReadiness(texture) { return pending.get(texture) ?? pending.get(texture.source); }

export async function awaitTextureReadiness(object, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  const textures = new Set();
  object.traverse(node => {
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      if (material) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  });
  const work = Promise.all([...textures].map(async texture => {
    await textureReadiness(texture);
    if (texture.userData.textureLoadError) throw new Error(`Texture failed to load: ${texture.userData.textureLoadError}`);
    const image = texture.image;
    if (!image || image.complete === false || !(image.width > 0 && image.height > 0))
      throw new Error(`Texture is not ready: ${texture.name || image?.src || texture.uuid}. Regenerate the asset and retry.`);
  }));
  let abort;
  try {
    if (!signal) return await work;
    await Promise.race([work, new Promise((_, reject) => {
      abort = () => reject(new DOMException('Export cancelled.', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}
