import { Box3, Group, Mesh, Vector3 } from 'three';
import { disposeObject } from '../environment/assets.js';
import { applyAssetTriangleTargets } from './triangle-targets.js';
import { fitTreeHeight, growTree, validateTreeHeight } from './tree-height.js';

export function createTreeLODAsset(tree, definition = {
  triangleTargets: tree.triangleTargets,
  targetHeight: tree.targetHeight,
}) {
  const height = validateTreeHeight(definition.targetHeight);
  const geometry = [];
  const dispose = () => geometry.splice(0).forEach(item => item.dispose());
  let fitted, replacement;
  try {
    // Exporters can supply a height independently of the live preview.
    if (tree.growth?.targetHeight !== height) {
      replacement = new tree.constructor();
      replacement.options = tree.options;
      growTree(replacement, height);
    }
    const source = replacement ?? tree;
    const lods = tree.constructor.defaultLODLevels.map(({ detail }, level) => {
      const { branches, leaves } = source.createGeometry(detail);
      geometry.push(branches, leaves);
      const group = new Group();
      group.name = `lod${level}`;
      group.userData = { archetype: 'tree', wind: true };
      const bark = new Mesh(branches, tree.branchesMesh.material);
      bark.name = 'Branches';
      const foliage = new Mesh(leaves, tree.leavesMesh.material);
      foliage.name = 'Leaves';
      foliage.userData.wind = true;
      group.add(bark, foliage);
      if (tree.trellisMesh) group.add(tree.trellisMesh.clone(true));
      return group;
    });
    if (lods.length !== 3) throw new Error('Expected three default tree LOD definitions.');
    const asset = { lods, object3D: lods[0], definition, dispose };
    fitted = applyAssetTriangleTargets(asset, { fixed: mesh => mesh.parent.name === 'Trellis', strict: true });
    if (height !== undefined) {
      const [bark, foliage] = fitted.lods[0].children;
      const fit = fitTreeHeight(bark.geometry, foliage.geometry, height);
      const scaled = new Set();
      for (const lod of fitted.lods) {
        for (const mesh of lod.children.slice(0, 2)) {
          if (scaled.has(mesh.geometry)) continue;
          mesh.geometry.scale(fit, fit, fit);
          scaled.add(mesh.geometry);
        }
        if (lod.userData.bounds) lod.userData.bounds = new Box3().setFromObject(lod).getSize(new Vector3()).toArray();
      }
      const correction = fit / source.growth.fit;
      fitted.trunkLength = source.growth.trunkLength * correction;
      fitted.trunkRadius = source.growth.trunkRadius * correction;
    }
    return fitted;
  } catch (error) {
    if (fitted) fitted.dispose();
    else dispose();
    throw error;
  } finally {
    if (replacement) disposeObject(replacement);
  }
}
