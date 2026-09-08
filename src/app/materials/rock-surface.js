import * as THREE from 'three';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Derive visible, tintable stone detail from the bundled source images.
 * These are artistic relief/roughness maps, not measured surface scans.
 * Called once per cached family, before any bright botanical/bark modulation.
 */
export function improveRockMaps(id, maps) {
  if (!['stone', 'sandstone'].includes(id)) return maps;
  const { map, normalMap, roughnessMap } = maps;
  const width = map.image.width, height = map.image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(map.image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const luminance = new Float32Array(width * height);
  let mean = 0;
  for (let i = 0; i < luminance.length; i++) {
    const p = i * 4;
    luminance[i] = .2126 * pixels.data[p] + .7152 * pixels.data[p + 1] + .0722 * pixels.data[p + 2];
    mean += luminance[i];
  }
  mean /= luminance.length;
  for (let i = 0; i < luminance.length; i++) {
    const p = i * 4, l = luminance[i];
    // Keep dark fissures and mineral flecks. A pale mean still lets the editor's
    // authored tint work without crushing its color by multiplying two dark maps.
    const value = 201 + (l - mean) * (id === 'stone' ? 2 : 1.65);
    for (let c = 0; c < 3; c++) pixels.data[p + c] = clamp(value + (pixels.data[p + c] - l) * .65, 48, 255);
  }
  ctx.putImageData(pixels, 0, 0);
  map.image = canvas; map.colorSpace = THREE.SRGBColorSpace;

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width; normalCanvas.height = height;
  const normalCtx = normalCanvas.getContext('2d', { willReadFrequently: true });
  normalCtx.drawImage(normalMap.image, 0, 0, width, height);
  const normals = normalCtx.getImageData(0, 0, width, height);
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width; roughCanvas.height = height;
  const roughCtx = roughCanvas.getContext('2d');
  const rough = roughCtx.createImageData(width, height);
  const sample = (x, y) => luminance[((y + height) % height) * width + ((x + width) % width)] / 255;
  const radius = Math.max(1, Math.round(width / 512));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = i * 4;
    const nz = Math.max(.15, normals.data[p + 2] / 127.5 - 1);
    // Combine source microrelief with a wider derivative so cracks still catch
    // light at ordinary viewing distances, with periodic edge sampling.
    const dx = (normals.data[p] / 127.5 - 1) / nz * 1.7 - (sample(x + radius, y) - sample(x - radius, y)) * 1.45;
    const dy = (normals.data[p + 1] / 127.5 - 1) / nz * 1.7 + (sample(x, y + radius) - sample(x, y - radius)) * 1.45;
    const length = Math.hypot(dx, dy, 1);
    normals.data[p] = (dx / length * .5 + .5) * 255;
    normals.data[p + 1] = (dy / length * .5 + .5) * 255;
    normals.data[p + 2] = (.5 / length + .5) * 255;
    const r = clamp(219 - (luminance[i] - mean) * .48, 173, 247);
    rough.data.set([r, r, r, 255], p);
  }
  normalCtx.putImageData(normals, 0, 0); normalMap.image = normalCanvas;
  roughCtx.putImageData(rough, 0, 0); roughnessMap.image = roughCanvas;
  for (const [slot, texture] of Object.entries(maps)) {
    texture.name = `${id}-${slot}-source-detail`;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }
  return maps;
}
