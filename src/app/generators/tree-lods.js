import { Box3, Group, Mesh, Vector3 } from 'three';
import { applyAssetTriangleTargets } from './triangle-targets.js';
import { adjustTreeGeometry, treeHeightAdjustment } from './tree-height.js';

export function createTreeLODAsset(tree, definition = {
  triangleTargets: tree.triangleTargets,
  targetHeight: tree.targetHeight,
}, { forPreview = false } = {}) {
  const geometry = [];
  const dispose = () => geometry.splice(0).forEach((item) => item.dispose());
  let fitted;
  try {
    const lods = tree.constructor.defaultLODLevels.map(({ detail }, level) => {
      const { branches, leaves } = tree.createGeometry(detail ?? {}, {
        leafAnchors: forPreview || definition.targetHeight !== undefined,
      });
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
      if (tree.trellisMesh) {
        const trellis = tree.trellisMesh.clone(true);
        trellis.scale.y = 1;
        group.add(trellis);
      }
      return group;
    });
    if (lods.length !== 3) throw new Error('Expected three default tree LOD definitions.');
    const asset = { lods, object3D: lods[0], definition, dispose };
    // Trellis rails and end caps are already low-poly and retain their shape.
    fitted = applyAssetTriangleTargets(asset, { fixed: (mesh) => mesh.parent.name === 'Trellis', strict: true });
    if (!forPreview && definition.targetHeight !== undefined) {
      const adjustment = treeHeightAdjustment(fitted.lods[0], definition.targetHeight);
      const adjusted = new Set();
      for (const lod of fitted.lods) {
        const [bark, foliage, trellis] = lod.children;
        for (const mesh of [bark, foliage]) {
          if (adjusted.has(mesh.geometry)) continue;
          adjustTreeGeometry(mesh.geometry, adjustment);
          adjusted.add(mesh.geometry);
        }
        if (trellis) trellis.scale.y = adjustment.woodScale;
        if (lod.userData.bounds) lod.userData.bounds = new Box3().setFromObject(lod).getSize(new Vector3()).toArray();
      }
      fitted.heightAdjustment = adjustment;
    }
    return fitted;
  } catch (error) {
    if (fitted) fitted.dispose();
    else dispose();
    throw error;
  }
}
