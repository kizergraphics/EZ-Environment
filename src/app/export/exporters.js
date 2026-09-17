import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash as hashData } from '../environment/random.js';
import { createExportSnapshot } from './snapshot.js';
import { appendMaterialCatalog, validateMaterialCatalog } from './material-catalog.js';
import { selectAssetAppearance } from '../environment/biome-species.js';
import { selectRockVariant } from '../generators/rocks.js';
import { awaitTextureReadiness } from '../materials/readiness.js';
import { prepareAssetMaterials, assertPbrReady } from '../materials/pbr.js';
import {
  zipSync,
  strToU8,
  strFromU8,
} from 'three/addons/libs/fflate.module.js';

const COORDINATES = {
  handedness: 'right',
  up: 'Y',
  units: 'meters',
  quaternion: 'xyzw',
};
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const cloneData = (value) =>
  value === undefined ? null : JSON.parse(JSON.stringify(value));
const finiteArray = (value, length) =>
  Array.isArray(value) &&
  value.length === length &&
  value.every(Number.isFinite);
const safePath = (path) =>
  typeof path === 'string' &&
  path.length < 250 &&
  !/[\\:\x00-\x1f]/.test(path) &&
  !path.startsWith('/') &&
  path.split('/').every((part) => part && part !== '.' && part !== '..');
function checkAbort(signal) {
  if (signal?.aborted)
    throw new DOMException('Export cancelled.', 'AbortError');
}
function filename(value, fallback) {
  return (
    String(value || fallback)
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .slice(0, 100) || fallback
  );
}
function triangleCount(object) {
  let count = 0;
  object.traverse((child) => {
    if (child.isMesh)
      count +=
        (child.geometry.index?.count ??
          child.geometry.attributes.position.count) / 3;
  });
  return count;
}

/** Same multiplication order as the viewport: terrain alignment, then local yaw. */
export function placementTransform(record) {
  if (record.rotation !== undefined) {
    if (
      !finiteArray(record.position, 3) ||
      !finiteArray(record.scale, 3) ||
      record.scale.some((n) => n <= 0) ||
      !finiteArray(record.rotation, 4) ||
      Math.abs(Math.hypot(...record.rotation) - 1) > 1e-5
    )
      throw new Error(
        'Placement contains invalid position, quaternion, or scale.',
      );
    return {
      position: [...record.position],
      rotation: [...record.rotation],
      scale: [...record.scale],
    };
  }
  if (
    !finiteArray(record.position, 3) ||
    !finiteArray(record.scale, 3) ||
    record.scale.some((n) => n <= 0) ||
    !finiteArray(record.normal, 3) ||
    !Number.isFinite(record.yaw)
  )
    throw new Error(
      'Placement contains invalid position, normal, yaw, or scale.',
    );
  const normal = new THREE.Vector3().fromArray(record.normal);
  if (normal.lengthSq() < 0.000001)
    throw new Error('Placement normal cannot be zero.');
  normal.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const rotation = new THREE.Quaternion()
    .setFromUnitVectors(up, normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(up, record.yaw));
  return {
    position: [...record.position],
    rotation: rotation.toArray(),
    scale: [...record.scale],
  };
}

/** Returns bytes only; download explicitly with downloadBlob. */
export async function exportGLB(object, name, options = {}) {
  if (name && typeof name === 'object') options = name;
  checkAbort(options.signal);
  const maxTextureSize = options.maxTextureSize ?? 2048;
  if (![128, 256, 512, 1024, 2048, 4096, 8192].includes(maxTextureSize))
    throw new Error(
      'Export texture size must be a power of two between 128 and 8192.',
    );
  if (!object?.isObject3D)
    throw new Error('GLB export requires a Three.js object.');
  const snapshot = createExportSnapshot();
  let result;
  try {
    const copy = snapshot.object(object);
    await awaitTextureReadiness(copy, options);
    await prepareAssetMaterials({ object3D: copy }, options);
    // Browser exports are finished surfaces. DOM-free geometry tools retain the
    // existing mesh-only API; explicitly opt in to full validation there.
    assertPbrReady(copy, { requireAll: options.requireTextures ?? typeof document !== 'undefined' });
    checkAbort(options.signal);
    result = await new GLTFExporter().parseAsync(copy, {
      binary: true,
      onlyVisible: false,
      trs: true,
      maxTextureSize,
    });
  } finally {
    snapshot.dispose();
  }
  checkAbort(options.signal);
  if (!(result instanceof ArrayBuffer) || result.byteLength < 20)
    throw new Error('GLB exporter returned no geometry.');
  return result;
}

export function downloadBlob(value, name = 'download') {
  if (typeof document === 'undefined')
    throw new Error(
      'Downloads require a browser. Use {download:false} to receive export bytes.',
    );
  const blob =
    value instanceof Blob
      ? value
      : new Blob([value], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename(name, 'download');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return blob;
}

export async function exportPNG(
  rendererOrCanvas,
  name = 'preview.png',
  { download = true } = {},
) {
  const canvas = rendererOrCanvas?.domElement ?? rendererOrCanvas;
  if (!canvas?.toBlob)
    throw new Error('PNG export requires a rendered canvas.');
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(
              new Error('PNG export failed. Render the scene before saving.'),
            ),
      'image/png',
    ),
  );
  if (download)
    downloadBlob(blob, name.endsWith('.png') ? name : `${name}.png`);
  return blob;
}

function assetDescriptor(id, asset, prefix = `assets/${id}/`) {
  if (!ID.test(id)) throw new Error(`Invalid export asset ID: ${id}`);
  const lods = asset.lods ?? [asset.object3D ?? asset];
  if (!lods.length || lods.some((lod) => !lod?.isObject3D))
    throw new Error(`Asset ${id} has no valid LODs.`);
  // Enabled identifies vegetation; attribute only names data actually present
  // in its geometry. Trees and loaded flowers use shader/height-based bending.
  let wind =
    [
      'tree',
      'grass',
      'shrub',
      'bush',
      'sapling',
      'fern',
      'weed',
      'groundCover',
      'flower',
    ].includes(asset.definition?.archetype) ||
    /^flower_(white|blue|yellow)$/.test(asset.definition?.source ?? '');
  let weighted = false;
  lods[0].traverse((o) => {
    if (o.geometry?.attributes.windWeight) weighted = true;
    if (
      o.userData.wind ||
      o.geometry?.attributes.windWeight ||
      o.material?.userData.wind
    )
      wind = true;
  });
  if(lods[0].userData.wind===false)wind=false;
  const bounds = new THREE.Box3().setFromObject(lods[0]);
  return {
    id,
    definitionHash: asset.definitionHash ?? null,
    preset: `${prefix}preset.json`,
    lods: lods.map((object, level) => ({
      level,
      file: `${prefix}lod${level}.glb`,
      triangles: triangleCount(object),
      screenRelativeHeight: [0.4, 0.12, 0.025][level] ?? 0.01,
    })),
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    collider: cloneData(asset.collider ?? { mode: 'none' }),
    wind: { enabled: wind, attribute: weighted ? '_WINDWEIGHT' : null },
  };
}

function exportedAsset(record, registry) {
  const id = record.species;
  const asset = registry.get(id);
  if (!asset) throw new Error(`Placement references missing species: ${id}`);
  const selected = selectRockVariant(asset, record.variationSeed ?? 0);
  return {
    id: selected === asset ? id : `${id}__v${selected.variantIndex + 1}`,
    asset: selected,
  };
}

function environmentAssetSources(environment) {
  const sources = new Map();
  for (const chunk of environment.placement.chunks.values())
    for (const layer of Object.values(chunk.layers))
      for (const record of layer.records) {
        const selected = exportedAsset(record, environment.registry);
        sources.set(selected.id, selected.asset);
      }
  return sources;
}

function chunkData(key, chunk, registry) {
  return {
    version: 1,
    id: key,
    x: chunk.x,
    z: chunk.z,
    layers: Object.keys(chunk.layers)
      .sort()
      .map((name) => ({
        name,
        instances: chunk.layers[name].records.map((record) => ({
          asset: exportedAsset(record, registry).id,
          ...placementTransform(record),
          tint: record.tint ?? 1,
          variationSeed: record.variationSeed ?? 0,
        })),
      })),
  };
}

/** Pure manifest builder; file inventory is filled after binary serialization. */
export function createEnvironmentManifest(environment) {
  if (
    !(environment.registry instanceof Map) ||
    !(environment.placement?.chunks instanceof Map)
  )
    throw new Error('Environment must finish generating before export.');
  const chunks = [...environment.placement.chunks.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const sources = environmentAssetSources(environment);
  const assets = [...sources.keys()].sort().map((id) => {
    const asset = sources.get(id);
    return assetDescriptor(id, selectAssetAppearance(asset, environment.options));
  });
  const staticObjects = [];
  if (environment.ground)
    staticObjects.push({ id: 'terrain', file: 'terrain.glb' });
  for (const entry of environment.exportObjects ?? []) {
    if (
      !ID.test(entry.id) ||
      entry.id === 'terrain' ||
      staticObjects.some((other) => other.id === entry.id) ||
      !entry.object?.isObject3D
    )
      throw new Error(
        'Static export objects require unique safe IDs and Three.js objects.',
      );
    staticObjects.push({ id: entry.id, file: `static/${entry.id}.glb` });
  }
  return {
    format: 'ez-environment',
    version: 1,
    kind: 'environment',
    coordinates: { ...COORDINATES },
    options: cloneData(environment.options),
    presentation: {
      appearance: environment.options.appearance ?? 'naturalistic',
      biome: environment.options.biome ?? null,
      lighting: cloneData(environment.options.lighting),
      materialFallback: 'glTF metallic-roughness PBR materials with embedded base color, normal, and roughness textures',
      limitations: [
        'Sky, fog, exposure, ambient occlusion, and viewport shadows must be recreated in the receiving renderer.',
        'Wind metadata is retained; animated vegetation requires a receiving shader.',
        'Static biome groves use their highest-detail geometry; viewport LOD selection is not exported.',
      ],
    },
    placementHash: environment.placement.hash ?? null,
    assets,
    chunks: chunks.map(([key, chunk]) => ({
      id: key,
      x: chunk.x,
      z: chunk.z,
      file: `chunks/chunk_${chunk.x}_${chunk.z}.json`,
      count: Object.values(chunk.layers).reduce(
        (sum, layer) => sum + layer.records.length,
        0,
      ),
    })),
    staticObjects,
    files: [],
  };
}

function entriesOf(inventory) {
  if (inventory instanceof Map) return inventory;
  if (inventory instanceof Set)
    return new Map([...inventory].map((path) => [path, null]));
  if (Array.isArray(inventory))
    return new Map(
      inventory.map((entry) =>
        typeof entry === 'string' ? [entry, null] : [entry.path, entry],
      ),
    );
  return new Map(Object.entries(inventory ?? {}));
}

/** Validate references and, when bytes are supplied, GLB headers and chunk data. */
export function validateManifest(manifest, inventory) {
  try {
    return validateManifestData(manifest, inventory);
  } catch (error) {
    return { valid: false, errors: [`Malformed manifest: ${error.message}`] };
  }
}

function validateManifestData(manifest, inventory) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!manifest || typeof manifest !== 'object')
    return { valid: false, errors: ['Manifest must be an object.'] };
  if (
    manifest.format !== 'ez-environment' ||
    manifest.version !== 1 ||
    !['environment', 'asset'].includes(manifest.kind)
  )
    fail('Unsupported manifest format, version, or kind.');
  if (JSON.stringify(manifest.coordinates) !== JSON.stringify(COORDINATES)) {
    for (const [key, value] of Object.entries(COORDINATES))
      if (manifest.coordinates?.[key] !== value)
        fail(`Expected coordinate ${key}=${value}.`);
  }
  const available = inventory === undefined ? null : entriesOf(inventory);
  const referenced = new Set(),
    ids = new Set(),
    chunkIDs = new Set();
  const reference = (path) => {
    if (!safePath(path)) {
      fail(`Unsafe file path: ${path}`);
      return;
    }
    if (referenced.has(path)) fail(`Duplicate file reference: ${path}`);
    referenced.add(path);
    if (available && !available.has(path)) fail(`Missing file: ${path}`);
  };
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (!Array.isArray(manifest.assets)) fail('Assets must be an array.');
  for (const asset of assets) {
    if (!ID.test(asset.id) || ids.has(asset.id))
      fail(`Invalid or duplicate asset ID: ${asset.id}`);
    ids.add(asset.id);
    reference(asset.preset);
    if (!Array.isArray(asset.lods) || asset.lods.length < 1) {
      fail(`Asset ${asset.id} has no LODs.`);
      continue;
    }
    let previous = Infinity;
    for (let level = 0; level < asset.lods.length; level++) {
      const lod = asset.lods[level];
      reference(lod.file);
      if (
        lod.level !== level ||
        !Number.isInteger(lod.triangles) ||
        lod.triangles <= 0 ||
        lod.triangles > previous ||
        !Number.isFinite(lod.screenRelativeHeight) ||
        lod.screenRelativeHeight <= 0 ||
        lod.screenRelativeHeight > 1
      )
        fail(`Invalid LOD ${level} for ${asset.id}.`);
      previous = lod.triangles;
    }
    if (
      !finiteArray(asset.bounds?.min, 3) ||
      !finiteArray(asset.bounds?.max, 3) ||
      asset.bounds.min.some((n, i) => n > asset.bounds.max[i])
    )
      fail(`Invalid bounds for ${asset.id}.`);
    if (!['none', 'box', 'sphere', 'convex'].includes(asset.collider?.mode))
      fail(`Invalid collider for ${asset.id}.`);
    if (
      asset.collider?.mode === 'box' &&
      (!finiteArray(asset.collider.center, 3) ||
        !finiteArray(asset.collider.size, 3) ||
        asset.collider.size.some((n) => n <= 0))
    )
      fail(`Invalid box collider for ${asset.id}.`);
    if (
      asset.collider?.mode === 'sphere' &&
      (!finiteArray(asset.collider.center, 3) ||
        !Number.isFinite(asset.collider.radius) ||
        asset.collider.radius <= 0)
    )
      fail(`Invalid sphere collider for ${asset.id}.`);
    if (
      asset.collider?.mode === 'convex' &&
      (!Array.isArray(asset.collider.vertices) ||
        !asset.collider.vertices.length ||
        asset.collider.vertices.length % 3 ||
        !asset.collider.vertices.every(Number.isFinite) ||
        !Array.isArray(asset.collider.indices) ||
        asset.collider.indices.length % 3 ||
        !asset.collider.indices.every(
          (i) =>
            Number.isInteger(i) &&
            i >= 0 &&
            i < asset.collider.vertices.length / 3,
        ))
    )
      fail(`Invalid convex collider for ${asset.id}.`);
  }
  for (const chunk of manifest.chunks ?? []) {
    if (
      chunkIDs.has(chunk.id) ||
      typeof chunk.id !== 'string' ||
      !Number.isInteger(chunk.x) ||
      !Number.isInteger(chunk.z) ||
      !Number.isInteger(chunk.count) ||
      chunk.count < 0
    )
      fail('Invalid or duplicate chunk.');
    chunkIDs.add(chunk.id);
    reference(chunk.file);
    const bytes = available?.get(chunk.file);
    if (bytes instanceof Uint8Array) {
      try {
        const data = JSON.parse(strFromU8(bytes));
        let count = 0;
        if (
          data.version !== 1 ||
          data.id !== chunk.id ||
          data.x !== chunk.x ||
          data.z !== chunk.z ||
          !Array.isArray(data.layers)
        )
          throw new Error('Chunk header mismatch.');
        const layers = new Set();
        for (const layer of data.layers) {
          if (
            typeof layer.name !== 'string' ||
            layers.has(layer.name) ||
            !Array.isArray(layer.instances)
          )
            throw new Error('Invalid chunk layer.');
          layers.add(layer.name);
          for (const record of layer.instances) {
            if (
              !ids.has(record.asset) ||
              !finiteArray(record.position, 3) ||
              !finiteArray(record.rotation, 4) ||
              Math.abs(Math.hypot(...record.rotation) - 1) > 1e-5 ||
              !finiteArray(record.scale, 3) ||
              record.scale.some((n) => n <= 0) ||
              !Number.isFinite(record.tint) ||
              record.tint < 0 ||
              !Number.isInteger(record.variationSeed) ||
              record.variationSeed < 0 ||
              record.variationSeed > 0xffffffff
            )
              throw new Error('Invalid chunk instance or missing asset.');
            count++;
          }
        }
        if (count !== chunk.count)
          throw new Error('Chunk instance count mismatch.');
      } catch (error) {
        fail(`${chunk.file}: ${error.message}`);
      }
    }
  }
  for (const object of manifest.staticObjects ?? []) reference(object.file);
  for (const extra of manifest.additionalExports ?? []) reference(extra.file);
  if (manifest.materialCatalog) {
    reference(manifest.materialCatalog);
    const bytes = available?.get(manifest.materialCatalog);
    if (bytes instanceof Uint8Array) {
      try {
        const catalog = JSON.parse(strFromU8(bytes));
        validateMaterialCatalog(catalog, available);
        for (const texture of catalog.textures) reference(texture.file);
      }
      catch (error) { fail(error.message); }
    }
  }
  const inventoryPaths = new Set();
  for (const file of manifest.files ?? []) {
    if (
      !safePath(file.path) ||
      inventoryPaths.has(file.path) ||
      !Number.isInteger(file.bytes) ||
      file.bytes <= 0
    )
      fail(`Invalid file inventory: ${file.path}`);
    inventoryPaths.add(file.path);
    const bytes = available?.get(file.path);
    if (bytes instanceof Uint8Array) {
      if (bytes.byteLength !== file.bytes)
        fail(`File size mismatch: ${file.path}`);
      if (file.path.endsWith('.glb')) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        if (
          bytes.length < 20 ||
          view.getUint32(0, true) !== 0x46546c67 ||
          view.getUint32(4, true) !== 2 ||
          view.getUint32(8, true) !== bytes.length
        )
          fail(`Invalid GLB header: ${file.path}`);
      }
    }
  }
  if (manifest.files?.length)
    for (const path of referenced)
      if (!inventoryPaths.has(path))
        fail(`Referenced file absent from inventory: ${path}`);
  return { valid: errors.length === 0, errors };
}

async function finishPack(manifest, files, name, options) {
  manifest.materialCatalog = await appendMaterialCatalog(files, options);
  manifest.files = Object.keys(files)
    .sort()
    .map((path) => ({ path, bytes: files[path].byteLength }));
  const validation = validateManifest(manifest, files);
  if (!validation.valid)
    throw new Error(`Export validation failed: ${validation.errors.join(' ')}`);
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['README.txt'] = strToU8(
    'EZ Environment portable asset pack, format version 1.\nUnits: meters. Right-handed, Y up. Quaternion order: x,y,z,w.\nExtract the complete ZIP before importing manifest.json.\nGLBs are self-contained. Separate reusable textures and materials.json are also included. Keep all pack paths intact.\nUnity: install com.unity.cloud.gltfast and use the included project Unity importer to create assigned, editable materials.\nPlant wind metadata is retained; the receiving game shader controls animation.\n' +
    (manifest.presentation ? '\nSurface appearance transfers as embedded glTF PBR textures, including baked terrain blends and selected foliage variants. Lighting-dependent visual parity is not guaranteed.\n' + manifest.presentation.limitations.map(note => `- ${note}`).join('\n') + '\nLighting and appearance metadata are recorded in manifest.presentation.\n' : ''),
  );
  checkAbort(options.signal);
  const zip = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, bytes]) => [
        path,
        [bytes, { mtime: new Date(1980, 0, 1) }],
      ]),
    ),
    { level: 6 },
  );
  const blob = new Blob([zip], { type: 'application/zip' });
  checkAbort(options.signal);
  if (options.download !== false)
    downloadBlob(blob, `${filename(name, 'environment')}.zip`);
  return { blob, manifest, files };
}

async function appendAsset(asset, descriptor, files, options) {
  files[descriptor.preset] = strToU8(
    JSON.stringify(asset.definition ?? {}, null, 2),
  );
  const lods = asset.lods ?? [asset.object3D ?? asset];
  for (const lod of descriptor.lods) {
    checkAbort(options.signal);
    files[lod.file] = new Uint8Array(await exportGLB(lods[lod.level], options));
    options.onProgress?.({ asset: descriptor.id, lod: lod.level });
  }
}

export async function exportAssetPack(asset, name = 'asset', options = {}) {
  checkAbort(options.signal);
  options = { maxTextureSize: 2048, ...options };
  const id = filename(name, 'asset').replace(/\./g, '-');
  const descriptor = assetDescriptor(id, asset, '');
  const manifest = {
    format: 'ez-environment',
    version: 1,
    kind: 'asset',
    exportSettings: { maxTextureSize: options.maxTextureSize },
    coordinates: { ...COORDINATES },
    assets: [descriptor],
    chunks: [],
    staticObjects: [],
    files: [],
  };
  const files = {};
  const snapshot = createExportSnapshot();
  try {
    const source = snapshot.asset(asset);
    await appendAsset(source, descriptor, files, options);
    return finishPack(manifest, files, name, options);
  } finally {
    snapshot.dispose();
  }
}

export async function exportEnvironmentPack(environment, options = {}) {
  options = { maxTextureSize: 2048, ...options };
  checkAbort(options.signal);
  if (environment.loading)
    throw new Error('Wait for environment generation before exporting.');
  const manifest = createEnvironmentManifest(environment);
  const exportSources = environmentAssetSources(environment);
  manifest.exportSettings = { maxTextureSize: options.maxTextureSize };
  const files = {};
  // Snapshot placements before asynchronous GLB work so UI edits cannot mix generations.
  for (const chunk of manifest.chunks)
    files[chunk.file] = strToU8(
      JSON.stringify(
        chunkData(chunk.id, environment.placement.chunks.get(chunk.id), environment.registry),
      ),
    );
  const snapshot = createExportSnapshot();
  try {
    // Capture every material, texture setting and hierarchy before the first
    // await. Grass palette or tree edits cannot produce mixed-generation LODs.
    const sources = new Map(
      manifest.assets.map((descriptor) => [
        descriptor.id,
        snapshot.asset(selectAssetAppearance(exportSources.get(descriptor.id), environment.options)),
      ]),
    );
    const staticSources = new Map(
      manifest.staticObjects.map((descriptor) => [
        descriptor.id,
        snapshot.object(
          descriptor.id === 'terrain'
            ? environment.ground
            : environment.exportObjects.find(
                (entry) => entry.id === descriptor.id,
              ).object,
        ),
      ]),
    );
    if (options.includeInstancedScene || options.includeBakedChunks) {
      await appendRenderExports(
        manifest,
        files,
        sources,
        staticSources,
        options,
      );
    }
    for (const descriptor of manifest.assets)
      await appendAsset(sources.get(descriptor.id), descriptor, files, options);
    for (const descriptor of manifest.staticObjects) {
      const object = staticSources.get(descriptor.id);
      files[descriptor.file] = new Uint8Array(await exportGLB(object, options));
    }
    return finishPack(manifest, files, options.name ?? 'environment', options);
  } finally {
    snapshot.dispose();
  }
}

function assetParts(object) {
  object.updateWorldMatrix(true, true);
  const parentInverse = object.parent
    ? object.parent.matrixWorld.clone().invert()
    : new THREE.Matrix4();
  const parts = [];
  object.traverse((mesh) => {
    if (mesh.isMesh)
      parts.push({
        geometry: mesh.geometry,
        material: mesh.material,
        matrix: parentInverse.clone().multiply(mesh.matrixWorld),
      });
  });
  return parts;
}

function renderChunk(data, sources, instanced, geometries, materials) {
  const root = new THREE.Group();
  root.name = `chunk_${data.x}_${data.z}`;
  const byAsset = new Map();
  for (const layer of data.layers)
    for (const record of layer.instances) {
      if (!byAsset.has(record.asset)) byAsset.set(record.asset, []);
      byAsset.get(record.asset).push(record);
    }
  const matrix = new THREE.Matrix4(),
    world = new THREE.Matrix4();
  const position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  const colors = new THREE.Color();
  for (const [id, records] of byAsset) {
    const asset = sources.get(id),
      parts = assetParts(asset.lods?.[0] ?? asset.object3D ?? asset);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (instanced) {
        const mesh = new THREE.InstancedMesh(
          part.geometry,
          part.material,
          records.length,
        );
        mesh.name = `${id}_${index}`;
        records.forEach((record, i) => {
          world.compose(
            position.fromArray(record.position),
            rotation.fromArray(record.rotation),
            scale.fromArray(record.scale),
          );
          matrix.multiplyMatrices(world, part.matrix);
          mesh.setMatrixAt(i, matrix);
          mesh.setColorAt(
            i,
            colors.setRGB(record.tint, record.tint, record.tint),
          );
        });
        root.add(mesh);
      } else {
        const copies = [];
        for (const record of records) {
          world.compose(
            position.fromArray(record.position),
            rotation.fromArray(record.rotation),
            scale.fromArray(record.scale),
          );
          matrix.multiplyMatrices(world, part.matrix);
          const copy = part.geometry.clone().applyMatrix4(matrix);
          geometries.add(copy);
          if (!copy.attributes.color)
            copy.setAttribute(
              'color',
              new THREE.Float32BufferAttribute(
                new Float32Array(copy.attributes.position.count * 3).fill(1),
                3,
              ),
            );
          const color = copy.attributes.color;
          for (let vertex = 0; vertex < color.count; vertex++)
            color.setXYZ(
              vertex,
              color.getX(vertex) * record.tint,
              color.getY(vertex) * record.tint,
              color.getZ(vertex) * record.tint,
            );
          copies.push(copy);
        }
        const geometry = mergeGeometries(copies, true);
        if (!geometry)
          throw new Error(`Cannot merge baked geometry for ${id}.`);
        geometries.add(geometry);
        for (const copy of copies) {
          copy.dispose();
          geometries.delete(copy);
        }
        // All copies in this merged batch use the same source material. Avoid
        // thousands of material groups, which would defeat the baked draw budget.
        geometry.clearGroups();
        if (Array.isArray(part.material))
          throw new Error(
            'Baked export requires each source mesh to use one material.',
          );
        const material = part.material.clone();
        material.vertexColors = true;
        materials.add(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${id}_${index}`;
        root.add(mesh);
      }
    }
  }
  root.updateMatrixWorld(true);
  return root;
}

async function appendRenderExports(
  manifest,
  files,
  sources,
  staticSources,
  options,
) {
  const geometries = new Set(),
    materials = new Set();
  let instanceScene = null;
  manifest.additionalExports = [];
  const dispose = () => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    geometries.clear();
    materials.clear();
    instanceScene?.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
    });
    instanceScene = null;
  };
  try {
    if (options.includeInstancedScene) {
      const scene = new THREE.Group();
      instanceScene = scene;
      scene.name = 'EZ Environment Instanced';
      for (const chunk of manifest.chunks) {
        checkAbort(options.signal);
        scene.add(
          renderChunk(
            JSON.parse(strFromU8(files[chunk.file])),
            sources,
            true,
            geometries,
            materials,
          ),
        );
      }
      for (const object of staticSources.values())
        scene.add(object.clone(true));
      files['scene.instanced.glb'] = new Uint8Array(
        await exportGLB(scene, options),
      );
      scene.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
      });
      instanceScene = null;
      manifest.additionalExports.push({
        kind: 'instanced-scene',
        file: 'scene.instanced.glb',
        lod: 0,
        extension: 'EXT_mesh_gpu_instancing',
      });
    }
    if (options.includeBakedChunks) {
      for (const chunk of manifest.chunks) {
        checkAbort(options.signal);
        if (!chunk.count) continue;
        const group = renderChunk(
          JSON.parse(strFromU8(files[chunk.file])),
          sources,
          false,
          geometries,
          materials,
        );
        const file = `baked/chunk_${chunk.x}_${chunk.z}.glb`;
        files[file] = new Uint8Array(await exportGLB(group, options));
        manifest.additionalExports.push({
          kind: 'baked-chunk',
          chunk: chunk.id,
          file,
          lod: 0,
        });
        dispose();
      }
    }
  } finally {
    dispose();
  }
}

function stableTreeData(value) {
  if (Array.isArray(value)) return `[${value.map(stableTreeData).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableTreeData(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function treeDefinition(tree) {
  const source = tree.options;
  const definition = cloneData({
    version: 1,
    archetype: 'tree',
    ...source,
    bark: { ...source.bark, maps: undefined },
    trellis: { ...source.trellis, maps: undefined, endMaps: undefined },
    leaves: { ...source.leaves, map: undefined, normalMap: undefined, roughnessMap: undefined },
  });
  let hash = 2166136261;
  for (const character of stableTreeData(definition))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return { definition, id: `tree-${hash.toString(16).padStart(8, '0')}` };
}

/** Package the full visible tree scene as reusable assets with explicit LODs. */
export async function exportScenePack(environment, treesArray, options = {}) {
  checkAbort(options.signal);
  if (
    !Array.isArray(treesArray) ||
    treesArray.some(
      (tree) =>
        !tree?.isObject3D ||
        typeof tree.createGeometry !== 'function' ||
        !tree.options ||
        !tree.branchesMesh?.material ||
        !tree.leavesMesh?.material,
    )
  )
    throw new Error('Scene export requires generated EZ-Tree instances.');
  if (
    !(environment.placement?.chunks instanceof Map) ||
    !(environment.registry instanceof Map)
  )
    throw new Error('Environment must finish generating before scene export.');
  const registry = new Map(environment.registry);
  const chunks = new Map(
    [...environment.placement.chunks].map(([key, chunk]) => [
      key,
      {
        ...chunk,
        layers: Object.fromEntries(
          Object.entries(chunk.layers).map(([layer, data]) => [
            layer,
            { ...data, records: [...data.records] },
          ]),
        ),
      },
    ]),
  );
  const generated = new Set();
  const chunkSize = environment.options.chunkSize ?? 48;
  try {
    for (const tree of treesArray) {
      checkAbort(options.signal);
      const { definition, id } = treeDefinition(tree);
      if (!registry.has(id)) {
        const levels = tree.constructor.defaultLODLevels;
        if (!Array.isArray(levels) || levels.length !== 3)
          throw new Error('Expected three default tree LOD definitions.');
        const lods = levels.map((level, index) => {
          const geometry = tree.createGeometry(level.detail ?? {});
          generated.add(geometry.branches);
          generated.add(geometry.leaves);
          const group = new THREE.Group();
          group.name = `lod${index}`;
          group.userData = { archetype: 'tree', wind: true };
          const branches = new THREE.Mesh(
            geometry.branches,
            tree.branchesMesh.material,
          );
          branches.name = 'Branches';
          const leaves = new THREE.Mesh(
            geometry.leaves,
            tree.leavesMesh.material,
          );
          leaves.name = 'Leaves';
          leaves.userData.wind = true;
          group.add(branches, leaves);
          if (tree.trellisMesh) group.add(tree.trellisMesh.clone(true));
          group.updateMatrixWorld(true);
          return group;
        });
        const length = definition.branch.length[0],
          radius = definition.branch.radius[0];
        registry.set(id, {
          lods,
          object3D: lods[0],
          definition,
          definitionHash: id,
          collider: options.treeColliders
            ? {
                mode: 'box',
                center: [0, length / 2, 0],
                size: [radius * 2, length, radius * 2],
              }
            : { mode: 'none' },
        });
      } else if (
        stableTreeData(registry.get(id).definition) !==
        stableTreeData(definition)
      )
        throw new Error(
          'Tree definition hash collision. Change one tree seed and retry.',
        );
      tree.updateWorldMatrix(true, false);
      const position = new THREE.Vector3(),
        rotation = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      tree.matrixWorld.decompose(position, rotation, scale);
      const x = Math.floor(position.x / chunkSize),
        z = Math.floor(position.z / chunkSize),
        key = `${x}:${z}`;
      if (!chunks.has(key)) chunks.set(key, { x, z, layers: {} });
      const chunk = chunks.get(key);
      chunk.layers.trees ??= { records: [], shortfall: 0, attempts: 0 };
      chunk.layers.trees.records.push({
        species: id,
        position: position.toArray(),
        rotation: rotation.toArray(),
        normal: [0, 1, 0],
        yaw: 0,
        scale: scale.toArray(),
        tint: 1,
        variationSeed: definition.seed,
      });
    }
    const wrapper = {
      registry,
      placement: {
        ...environment.placement,
        chunks,
        hash: hashData([...chunks.values()]),
      },
      options: {
        ...cloneData(environment.options),
        forest: { seed: 18427, count: treesArray.length },
      },
      loading: environment.loading,
      ground: environment.ground,
      exportObjects: (environment.exportObjects ?? []).filter(
        (entry) => !treesArray.includes(entry.object),
      ),
    };
    return await exportEnvironmentPack(wrapper, options);
  } finally {
    for (const geometry of generated) geometry.dispose();
  }
}
