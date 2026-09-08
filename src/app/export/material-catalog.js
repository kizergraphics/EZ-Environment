const encoder = new TextEncoder();
const decoder = new TextDecoder();
const textureSlots = [
  'baseColorTexture',
  'metallicRoughnessTexture',
  'normalTexture',
  'occlusionTexture',
  'emissiveTexture',
];
const stable = (value) =>
  Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);
const digest = async (bytes) =>
  [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
function abort(signal) {
  if (signal?.aborted)
    throw new DOMException('Export cancelled.', 'AbortError');
}

export function readGLB(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw new Error('Invalid GLB for material extraction.');
  let json, binary;
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk.');
    const length = view.getUint32(offset, true),
      type = view.getUint32(offset + 4, true);
    if (offset + 8 + length > bytes.length)
      throw new Error('Truncated GLB data.');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(decoder.decode(chunk));
    else if (type === 0x004e4942) binary = chunk;
    else throw new Error('Unsupported GLB chunk.');
    offset += 8 + length;
  }
  if (!json) throw new Error('GLB has no JSON chunk.');
  return { json, binary };
}

function writeGLB(json, binary) {
  const text = encoder.encode(JSON.stringify(json)),
    length = Math.ceil(text.length / 4) * 4;
  const result = new Uint8Array(20 + length + (binary ? 8 + binary.length : 0));
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.length, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + length);
  result.set(text, 20);
  if (binary) {
    view.setUint32(20 + length, binary.length, true);
    view.setUint32(24 + length, 0x004e4942, true);
    result.set(binary, 28 + length);
  }
  return result;
}

async function roughnessPNG(bytes) {
  const image = await createImageBitmap(
    new Blob([bytes], { type: 'image/png' }),
    { colorSpaceConversion: 'none', premultiplyAlpha: 'none' },
  );
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = pixels.data[i + 2] = pixels.data[i + 1];
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('Could not encode roughness texture.')),
        'image/png',
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    image.close();
  }
}

/** Derive portable source files from the final embedded bytes, never live textures. */
export async function appendMaterialCatalog(files, { signal } = {}) {
  const catalog = { version: 1, materials: [], bindings: [], textures: [] };
  const materials = new Map(),
    images = new Map(),
    roughness = new Map();
  for (const file of Object.keys(files)
    .filter((file) => file.endsWith('.glb'))
    .sort()) {
    abort(signal);
    const { json, binary } = readGLB(files[file]);
    const imagePaths = [];
    for (const image of json.images ?? []) {
      const view = json.bufferViews?.[image.bufferView];
      if (
        !binary ||
        !view ||
        (view.buffer ?? 0) !== 0 ||
        image.uri ||
        !['image/png', 'image/jpeg'].includes(image.mimeType)
      )
        throw new Error(`${file}: texture must be an embedded PNG or JPEG.`);
      const start = view.byteOffset ?? 0;
      if (
        start < 0 ||
        !Number.isInteger(view.byteLength) ||
        view.byteLength <= 0 ||
        start + view.byteLength > binary.length
      )
        throw new Error(`${file}: invalid embedded image bounds.`);
      const bytes = binary.subarray(start, start + view.byteLength);
      const path = `textures/${await digest(bytes)}.${image.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
      if (!images.has(path)) {
        files[path] = bytes.slice();
        images.set(path, { file: path, mimeType: image.mimeType });
      }
      imagePaths.push(path);
    }
    const info = (source) => {
      const texture = json.textures?.[source.index],
        file = imagePaths[texture?.source];
      if (!file) throw new Error('Material references a missing texture.');
      const { index, ...settings } = source;
      return {
        ...settings,
        file,
        sampler: json.samplers?.[texture.sampler] ?? {},
      };
    };
    const binding = { file, materials: [] };
    for (const source of json.materials ?? []) {
      abort(signal);
      const { name, extras, ...properties } = structuredClone(source);
      for (const owner of [properties, properties.pbrMetallicRoughness])
        if (owner)
          for (const slot of textureSlots)
            if (owner[slot]) owner[slot] = info(owner[slot]);
      // Keep all glTF factors, texture coordinates and transforms in the identity.
      const id = `ezmat_${await digest(encoder.encode(stable(properties)))}`;
      if (!materials.has(id)) {
        const material = { id, name: name || 'Surface', ...properties };
        const packed =
          properties.pbrMetallicRoughness?.metallicRoughnessTexture?.file;
        if (packed) {
          if (!roughness.has(packed)) {
            if (typeof document === 'undefined')
              throw new Error('Textured companion exports require a browser.');
            const bytes = await roughnessPNG(files[packed]);
            const path = `textures/${await digest(bytes)}.png`;
            files[path] ??= bytes;
            images.set(path, { file: path, mimeType: 'image/png' });
            roughness.set(packed, path);
          }
          material.roughnessTexture = {
            ...properties.pbrMetallicRoughness.metallicRoughnessTexture,
            file: roughness.get(packed),
            channel: 'r',
          };
        }
        materials.set(id, material);
      }
      source.name = id;
      binding.materials.push(id);
    }
    catalog.bindings.push(binding);
    files[file] = writeGLB(json, binary);
  }
  abort(signal);
  catalog.materials = [...materials.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  catalog.textures = [...images.values()].sort((a, b) =>
    a.file.localeCompare(b.file),
  );
  files['materials.json'] = encoder.encode(JSON.stringify(catalog, null, 2));
  files['textures/README.txt'] = encoder.encode(
    'Texture companions are extracted from the embedded GLB images. Base color is sRGB; normals and roughness are linear data. Normal maps use the OpenGL convention. glTF packed metallic-roughness uses green=roughness, blue=metalness. Separate grayscale roughness maps are also supplied. See materials.json for names, factors, UV channels, transforms, samplers and per-GLB material bindings. Do not apply baked lighting to these surface maps.\n',
  );
  if (typeof document !== 'undefined') {
    for (const [source, target] of [
      ['/textures/LICENSE.md', 'textures/SOURCES.md'],
      ['/textures/biomes/provenance.json', 'textures/biome-provenance.json'],
      ['/textures/plants/provenance.json', 'textures/plant-provenance.json'],
      ['/textures/wood/provenance.json', 'textures/wood-provenance.json'],
      ['/licenses/EZ-TREE-LICENSE.txt', 'textures/LICENSE.txt'],
    ]) {
      abort(signal);
      const response = await fetch(source, { signal });
      if (!response.ok)
        throw new Error(
          `Could not include bundled texture attribution: ${source}`,
        );
      files[target] = new Uint8Array(await response.arrayBuffer());
    }
    files['textures/SOURCES.md'] = encoder.encode(
      decoder.decode(files['textures/SOURCES.md']) +
        '\nGenerated plant foliage uses an ImageGen leaf-interior source; see plant-provenance.json. Stem, petal, pollen and retained tree microdetail are original analytic code under the project MIT license (LICENSE.txt). Authored maps, generated albedos and derived normal/roughness maps are artistic approximations, not measured scans. See biome-provenance.json for biome records.\n',
    );
  }
  return 'materials.json';
}

export function validateMaterialCatalog(catalog, files) {
  if (
    catalog?.version !== 1 ||
    !Array.isArray(catalog.materials) ||
    !Array.isArray(catalog.bindings) ||
    !Array.isArray(catalog.textures)
  )
    throw new Error('Unsupported material catalog.');
  const safe = (path) =>
    typeof path === 'string' &&
    !/[\\:\x00-\x1f]/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..');
  const requireFile = (path) => {
    if (!safe(path) || !files.has(path))
      throw new Error(`Missing or unsafe material file: ${path}`);
  };
  const ids = new Set();
  for (const material of catalog.materials) {
    if (!/^ezmat_[a-f0-9]{64}$/.test(material.id) || ids.has(material.id))
      throw new Error('Invalid or duplicate material ID.');
    ids.add(material.id);
    for (const owner of [material, material.pbrMetallicRoughness])
      if (owner)
        for (const slot of [...textureSlots, 'roughnessTexture'])
          if (owner[slot]) requireFile(owner[slot].file);
  }
  for (const texture of catalog.textures) requireFile(texture.file);
  const bound = new Set();
  for (const binding of catalog.bindings) {
    requireFile(binding.file);
    if (
      bound.has(binding.file) ||
      !binding.file.endsWith('.glb') ||
      !Array.isArray(binding.materials) ||
      binding.materials.some((id) => !ids.has(id))
    )
      throw new Error('Invalid material binding.');
    bound.add(binding.file);
    const bytes = files.get(binding.file);
    if (bytes instanceof Uint8Array) {
      const { json } = readGLB(bytes);
      if (
        JSON.stringify((json.materials ?? []).map((m) => m.name)) !==
        JSON.stringify(binding.materials)
      )
        throw new Error(`Material bindings differ from ${binding.file}.`);
    }
  }
  for (const file of files.keys())
    if (file.endsWith('.glb') && !bound.has(file))
      throw new Error(`Missing material binding: ${file}`);
  return true;
}
