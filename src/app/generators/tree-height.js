import { Vector3 } from 'three';

export const TREE_HEIGHT_LIMITS = Object.freeze({ min: .1, max: 1000 });

export function validateTreeHeight(value) {
  if (value === undefined) return undefined;
  const { min, max } = TREE_HEIGHT_LIMITS;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Tree height must be between ${min} and ${max} meters.`);
  }
  return value;
}

function top(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox.max.y;
}

// Ground-to-tip in model space, excluding any separately authored trellis.
export function treeHeight(branches, leaves) {
  return Math.max(0, top(branches), top(leaves));
}

export function treeHeightAdjustment(reference, height) {
  if (height === undefined) return { woodScale: 1, leafScale: 1 };
  const [bark, foliage] = reference.children;
  const parts = { bark: bark.geometry, foliage: foliage.geometry };
  const naturalHeight = treeHeight(parts.bark, parts.foliage);
  let retention = Math.min(1, height / naturalHeight);
  const points = parts.foliage.getAttribute('position');
  const anchors = parts.foliage.getAttribute('leafAnchorY');
  for (let i = 0; i < points.count; i++) {
    const offset = points.getY(i) - anchors.getX(i);
    if (offset > height) retention = Math.min(retention, .98 * height / offset);
  }

  const barkTop = top(parts.bark);
  let woodScale = barkTop > 0 ? height / barkTop : Infinity;
  for (let i = 0; i < points.count; i++) {
    const y = points.getY(i);
    const retained = (y - anchors.getX(i)) * retention;
    // Branches and leaf anchors move together. The retained part of each
    // card's vertical span stays intact and the rest follows the same scale.
    if (y > retained) woodScale = Math.min(woodScale, (height - retained) / (y - retained));
  }
  return { woodScale, leafScale: retention + (1 - retention) * woodScale };
}

export function adjustTreeGeometry(geometry, { woodScale, leafScale }) {
  const anchors = geometry.getAttribute('leafAnchorY');
  if (!anchors) {
    if (woodScale !== 1) geometry.scale(1, woodScale, 1);
    return;
  }
  geometry.deleteAttribute('leafAnchorY');
  if (woodScale === 1 && leafScale === 1) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const direction = new Vector3();
  for (let index = 0; index < position.count; index++) {
    const anchor = anchors.getX(index);
    position.setY(index, anchor * woodScale + (position.getY(index) - anchor) * leafScale);
    if (leafScale !== 1) {
      direction.fromBufferAttribute(normal, index);
      direction.y /= leafScale;
      direction.normalize();
      normal.setXYZ(index, direction.x, direction.y, direction.z);
    }
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
