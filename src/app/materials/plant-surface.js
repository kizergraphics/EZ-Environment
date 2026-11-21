import { ClampToEdgeWrapping, RepeatWrapping } from 'three';
import { LEAF_TEXTURE_REGISTRY, leafTextureInfo, legacyLeafTexture } from '../generators/leaf-textures.js';
import { grassAtlas } from '../generators/grass-atlases.js';
import { companionMaps, loadSurfaceMaps } from './surface-maps.js';

const detailFamilies = new Set(['stem', 'petal', 'pollen']);

export function loadPlantDetail(id) {
  if (!detailFamilies.has(id)) throw new Error(`Unknown plant detail: ${id}`);
  const base = `/textures/plants/details/${id}`;
  return loadSurfaceMaps(id, companionMaps(`${base}-color.jpg`, base));
}

export function loadLeafSurface(id = 'legacy-broad') {
  if (id === 'fern-frond') {
    return loadSurfaceMaps('Fern frond', companionMaps('/textures/biomes/foliage/fern-frond.png'), {
      wrap: ClampToEdgeWrapping,
    });
  }
  const definition = leafTextureInfo(Object.hasOwn(LEAF_TEXTURE_REGISTRY, id) ? id : legacyLeafTexture(id));
  const paths = companionMaps(definition.path);
  if (definition.atlasCells === 1) paths[0] = paths[0].replace('.png', '-color.jpg');
  return loadSurfaceMaps(definition.name, paths, {
    wrap: definition.atlasCells > 1 ? ClampToEdgeWrapping : RepeatWrapping,
  });
}

export function loadGrassCardSurface(id = 'meadow-v1') {
  const atlas = grassAtlas(id);
  if (!atlas) throw new Error(`Unknown grass atlas: ${id}`);
  return loadSurfaceMaps(`Grass ${id}`, companionMaps(atlas.path), { wrap: ClampToEdgeWrapping });
}
