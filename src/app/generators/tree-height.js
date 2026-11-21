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

export function fitTreeHeight(branches, leaves, height) {
  const measured = treeHeight(branches, leaves);
  if (!Number.isFinite(measured) || measured <= 0) {
    throw new Error('The generated tree needs a finite height above ground.');
  }
  return height / measured;
}

// Grow with the authored seed and settings. A height changes growth lengths by
// branch level. Radii and foliage stay round and square in their local frames.
export function growTree(tree, targetHeight) {
  tree.generate();
  tree.growth = undefined;
  if (targetHeight === undefined) return;

  const naturalHeight = treeHeight(tree.branchesMesh.geometry, tree.leavesMesh.geometry);
  const ratio = fitTreeHeight(tree.branchesMesh.geometry, tree.leavesMesh.geometry, targetHeight);
  const maturity = Math.min(4, Math.max(.25, ratio));
  const authored = tree.options;
  const growth = {
    ...authored,
    branch: {
      ...authored.branch,
      length: { ...authored.branch.length },
      radius: { ...authored.branch.radius },
      force: { ...authored.branch.force },
      gnarliness: { ...authored.branch.gnarliness },
    },
    leaves: { ...authored.leaves },
  };
  for (const [level, length] of Object.entries(authored.branch.length)) {
    growth.branch.length[level] = length * ratio * maturity ** (-.15 * Number(level));
  }
  const radiusScale = ratio * maturity ** .1;
  growth.branch.radius[0] *= radiusScale;
  growth.branch.force.strength *= radiusScale;
  const bendScale = Math.sqrt(Math.min(1, radiusScale));
  for (const level of Object.keys(growth.branch.gnarliness)) growth.branch.gnarliness[level] *= bendScale;

  // Keep natural leaf size unless a very small tree needs smaller leaf cards.
  const maximumCard = authored.leaves.size * (1 + authored.leaves.sizeVariance);
  if (maximumCard > 0) growth.leaves.size *= Math.min(1, targetHeight / (4 * maximumCard));

  tree.options = growth;
  try {
    tree.generate();
  } finally {
    tree.options = authored;
  }

  // The branches and leaves were emitted from the new skeleton. Calibrate its
  // final dimensions uniformly, including the horizontal axes.
  const branches = tree.branchesMesh.geometry, leaves = tree.leavesMesh.geometry;
  const fit = fitTreeHeight(branches, leaves, targetHeight);
  branches.scale(fit, fit, fit);
  leaves.scale(fit, fit, fit);
  tree.growth = {
    targetHeight,
    naturalHeight,
    fit,
    trunkLength: growth.branch.length[0] * fit,
    trunkRadius: growth.branch.radius[0] * fit,
  };
}
