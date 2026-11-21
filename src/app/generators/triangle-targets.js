import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

export const triangleSimplifierReady = MeshoptSimplifier.ready;

export function validateTriangleTargets(targets) {
  if (targets === undefined) return undefined;
  if (!Array.isArray(targets) || targets.length !== 3) {
    throw new Error('Enter one triangle target for each of LOD 0, 1, and 2.');
  }
  let previous = Infinity;
  const result = Array.from(targets, (target, level) => {
    if (target === null) return null;
    if (!Number.isSafeInteger(target) || target < 1) {
      throw new Error(`LOD ${level} needs a positive whole triangle count.`);
    }
    if (target > previous) throw new Error('Lower-detail targets must be at or below earlier targets.');
    previous = target;
    return target;
  });
  return result.some((target) => target !== null) ? result : undefined;
}

function meshTriangles(mesh) {
  return (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
}

export function triangleCount(object) {
  let count = 0;
  object.traverse((mesh) => { if (mesh.isMesh) count += meshTriangles(mesh); });
  return count;
}

function allocateTargets(parts, budget) {
  const minimum = parts.reduce((sum, part) => sum + part.minimum, 0);
  const available = parts.reduce((sum, part) => sum + part.count, 0) - minimum;
  const extras = Math.min(available, Math.max(0, budget - minimum));
  let cumulative = 0;
  let assigned = 0;
  return parts.map(({ count, minimum }) => {
    cumulative += count - minimum;
    const throughPart = available ? Math.floor(extras * cumulative / available) : 0;
    const target = minimum + throughPart - assigned;
    assigned = throughPart;
    return target;
  });
}

function compactGeometry(source, indices) {
  const [remap, count] = MeshoptSimplifier.compactMesh(indices);
  const result = new BufferGeometry();
  result.name = source.name;
  result.userData = { ...source.userData };
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const { itemSize, array, normalized } = attribute;
    const compact = new array.constructor(count * itemSize);
    for (let i = 0; i < remap.length; i++) {
      if (remap[i] !== 0xffffffff) compact.set(array.subarray(i * itemSize, (i + 1) * itemSize), remap[i] * itemSize);
    }
    result.setAttribute(name, new BufferAttribute(compact, itemSize, normalized));
  }
  result.setIndex(new BufferAttribute(count <= 65536 ? new Uint16Array(indices) : indices, 1));
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function simplifyGeometry(geometry, target, strict) {
  const { position, normal, uv } = geometry.attributes;
  const indices = new Uint32Array(geometry.index?.array ?? position.count);
  if (!geometry.index) for (let i = 0; i < indices.length; i++) indices[i] = i;

  if (geometry.userData.cardIndices) {
    // Each card is a quad. Keep its atlas, wind weights, and editable plane data intact.
    const cards = Math.max(1, Math.floor(target / 2));
    const result = compactGeometry(geometry, indices.slice(0, cards * 6));
    result.userData = {
      ...result.userData,
      cards,
      cardIndices: geometry.userData.cardIndices.slice(0, cards),
      basePositions: geometry.userData.basePositions.slice(0, cards * 12),
      baseUvs: geometry.userData.baseUvs.slice(0, cards * 8),
    };
    return result;
  }

  const weights = [...(normal ? [.25, .25, .25] : []), ...(uv ? [.5, .5] : [])];
  const attributes = new Float32Array(position.count * weights.length);
  for (let i = 0, offset = 0; i < position.count; i++) {
    if (normal) { attributes.set(normal.array.subarray(i * 3, i * 3 + 3), offset); offset += 3; }
    if (uv) { attributes.set(uv.array.subarray(i * 2, i * 2 + 2), offset); offset += 2; }
  }
  const goal = target * 3;
  const simplify = (flags) => MeshoptSimplifier.simplifyWithAttributes(
    indices, position.array, 3, attributes, weights.length, weights, null, goal, 1, flags,
  )[0];
  let reduced = simplify(['Permissive']);
  if (reduced.length > goal) {
    const pruned = simplify(['Permissive', 'Prune']);
    if (pruned.length && (strict && pruned.length <= goal || Math.abs(pruned.length - goal) < reduced.length - goal)) reduced = pruned;
  }
  if (strict && (!reduced.length || reduced.length > goal)) {
    const coarse = MeshoptSimplifier.simplifySloppy(indices, position.array, 3, null, goal, 1)[0];
    if (coarse.length && coarse.length <= goal) {
      reduced = coarse;
    } else {
      // At extreme budgets some disconnected surfaces cannot collapse any
      // further. Retain triangles across the mesh rather than exceed the cap.
      reduced = new Uint32Array(goal);
      const count = indices.length / 3;
      for (let i = 0; i < target; i++) {
        const start = Math.floor((i + .5) * count / target) * 3;
        reduced.set(indices.subarray(start, start + 3), i * 3);
      }
    }
  }
  return reduced.length && reduced.length < indices.length ? compactGeometry(geometry, reduced) : geometry;
}

/** Wrap an asset without taking ownership of its existing materials or geometry twice. */
export function applyAssetTriangleTargets(asset, { fixed = () => false, keepEditorSource = false, strict = false } = {}) {
  const targets = asset.definition.triangleTargets;
  if (!targets) return asset;
  const geometries = new Set();
  const simplified = new Map();
  const cache = new Map();

  function fitLevels(lods) {
    if (cache.has(lods)) return cache.get(lods);
    const counts = lods.map(triangleCount);
    const fitted = [];
    for (const [level, automatic] of lods.entries()) {
      const previous = fitted.at(-1);
      const ceiling = previous ? triangleCount(previous) : counts[0];
      const goal = Math.min(targets[level] ?? counts[level], ceiling);
      if (goal === counts[level]) { fitted.push(automatic); continue; }

      // Starting from the closest procedural LOD keeps its silhouette and the
      // authored distribution of foliage when making further reductions.
      let source = level;
      for (const [index, count] of counts.entries()) {
        if (count >= goal && (counts[source] < goal || count < counts[source])) source = index;
      }
      const group = lods[source].clone(true);
      const parts = [];
      let reserved = 0;
      group.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const count = meshTriangles(mesh);
        if (fixed(mesh) || Array.isArray(mesh.material)) reserved += count;
        else if (count) parts.push({ mesh, count, minimum: mesh.geometry.userData.cardIndices ? 2 : 1 });
      });
      const minimum = parts.reduce((sum, part) => sum + part.minimum, reserved);
      if (strict && goal < minimum) throw new Error(`LOD ${level} needs at least ${minimum} triangles to retain its mesh parts.`);
      const budgets = allocateTargets(parts, goal - reserved);
      for (const [index, { mesh, count }] of parts.entries()) {
        if (budgets[index] >= count) continue;
        const original = mesh.geometry;
        if (!simplified.has(original)) simplified.set(original, new Map());
        const targetsByGeometry = simplified.get(original);
        const budget = budgets[index];
        if (!targetsByGeometry.has(budget)) {
          const geometry = simplifyGeometry(original, budget, strict);
          targetsByGeometry.set(budget, geometry);
          if (geometry !== original) geometries.add(geometry);
        }
        mesh.geometry = targetsByGeometry.get(budget);
      }
      const selected = previous && triangleCount(group) > ceiling ? previous.clone(true) : group;
      selected.name = automatic.name;
      selected.userData = {
        ...automatic.userData,
        triangles: triangleCount(selected),
        bounds: new Box3().setFromObject(selected).getSize(new Vector3()).toArray(),
      };
      fitted.push(selected);
    }
    cache.set(lods, fitted);
    return fitted;
  }

  try {
    const lods = fitLevels(asset.lods);
    const result = { ...asset, lods, object3D: lods[0] };
    if (keepEditorSource && lods[0] !== asset.lods[0]) result.editorObject = asset.lods[0];
    if (asset.variants) result.variants = asset.variants.map((variant) => {
      const levels = fitLevels(variant.lods);
      return { ...variant, lods: levels, object3D: levels[0] };
    });
    result.dispose = () => {
      geometries.forEach((geometry) => geometry.dispose());
      geometries.clear();
      asset.dispose();
    };
    return result;
  } catch (error) {
    geometries.forEach((geometry) => geometry.dispose());
    throw error;
  }
}
