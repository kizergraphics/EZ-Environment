import * as THREE from 'three';

const leafSources = new Map();
const textureFamily = design => ['lobed', 'heart', 'trifoliate'].includes(design) ? 'palmate'
  : ['lanceolate', 'fernPinna', 'succulent'].includes(design) ? 'parallel'
    : ['coniferNeedle', 'cushionScale', 'grassBlade'].includes(design) ? 'needle' : 'broad';
const sourcePath = family => family === 'broad' ? '/textures/plants/leaf-surface-v1.png' : `/textures/plants/leaf-surface-${family}-v1.png`;

/** Whole leaf interiors, not branch atlases: each generated blade gets matching venation. */
export async function loadLeafSurface(design = 'oval') {
  const family = textureFamily(design);
  if (!leafSources.has(family)) leafSources.set(family, (async () => {
    const source = await new THREE.TextureLoader().loadAsync(sourcePath(family));
    try {
      const size = 1024, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.drawImage(source.image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size), luminance = new Float32Array(size * size);
      let mean = 0;
      for (let i = 0; i < luminance.length; i++) {
        const p = i * 4;
        luminance[i] = pixels.data[p] * .2126 + pixels.data[p + 1] * .7152 + pixels.data[p + 2] * .0722;
        mean += luminance[i];
      }
      mean /= luminance.length;
      const color = new Uint8ClampedArray(pixels.data.length), normal = color.slice(), roughness = color.slice();
      const sample = (x, y) => luminance[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x, p = i * 4, detail = luminance[i] - mean;
        // Retain the photographed vein/tissue contrast while allowing every
        // authored leaf color (including red/autumn presets) to remain useful.
        const shade = Math.max(65, Math.min(255, 181 + detail * 2.65));
        color.set([shade, Math.min(255, shade + 3), Math.max(0, shade - 5), 255], p);
        const dx = (sample(x + 2, y) - sample(x - 2, y)) / 130;
        const dy = (sample(x, y + 2) - sample(x, y - 2)) / 130;
        const length = Math.hypot(dx, dy, 1);
        normal.set([127.5 * (1 - dx / length), 127.5 * (1 + dy / length), 127.5 * (1 + 1 / length), 255], p);
        const r = Math.max(130, Math.min(235, 195 - detail * .65));
        roughness.set([r, r, r, 255], p);
      }
      const texture = (data, name, srgb = false) => {
        const image = document.createElement('canvas'); image.width = image.height = size;
        image.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
        const map = new THREE.CanvasTexture(image); map.name = `Leaf surface ${name}`;
        map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
        // Source base is at the bottom of the image and generated blade v=0.
        map.flipY = true; map.userData = { leafSurfaceFamily: family };
        return map;
      };
      return { map: texture(color, 'color', true), normalMap: texture(normal, 'normal'), roughnessMap: texture(roughness, 'roughness') };
    } finally { source.dispose(); }
  })().catch(error => { leafSources.delete(family); throw new Error(`Leaf surface texture failed to load: ${error.message}`); }));
  return leafSources.get(family);
}

const details = new Map();
/** Stronger plant skin and petal detail; tree templates are never modified. */
export function plantDetailMaps(id, original) {
  if (details.has(id)) return details.get(id);
  const source = original.map.image;
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let mean = 0;
  for (let i = 0; i < pixels.data.length; i += 4) mean += pixels.data[i];
  mean /= pixels.data.length / 4;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = Math.max(95, Math.min(255, 202 + (pixels.data[i] - mean) * (id === 'petal' ? 3.4 : 4.5)));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const map = original.map.clone(); map.source = new THREE.Source(canvas); map.name = `${id} surface color`; map.needsUpdate = true;
  const result = { ...original, map }; details.set(id, result); return result;
}
