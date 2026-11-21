import TreeOptions from '../options';
import { Billboard, TreeType } from '../enums';

function species(id, seed, type, branch, leaves, textureScale) {
  const options = new TreeOptions();
  options.copy({
    seed,
    type,
    bark: { type: id, textureScale },
    branch,
    leaves: { type: id, alphaTest: .44, ...leaves },
  });
  return structuredClone(options);
}

export const treeSpeciesPresets = {
  'Paper Birch': species('paper-birch', 58273, TreeType.Deciduous, {
    levels: 2,
    length: { 0: 25, 1: 8.5, 2: 4.8 },
    children: { 0: 13, 1: 4 },
    angle: { 1: 33, 2: 47 },
    start: { 1: .30, 2: .23 },
    radius: { 0: .78, 1: .38, 2: .38 },
    taper: { 0: .63, 1: .63 },
    gnarliness: { 0: .035, 1: .12, 2: .12 },
    force: { strength: .017 },
  }, { angle: 48, count: 12, start: .18, size: 1.65, sizeVariance: .43 }, { x: 1, y: 2.8 }),

  'Weeping Willow': species('weeping-willow', 59146, TreeType.Deciduous, {
    levels: 3,
    length: { 0: 19, 1: 12, 2: 8.5, 3: 6.4 },
    children: { 0: 8, 1: 4, 2: 3 },
    angle: { 1: 52, 2: 37, 3: 21 },
    start: { 1: .58, 2: .35, 3: .35 },
    radius: { 0: 1.42, 1: .6, 2: .43, 3: .42 },
    taper: { 0: .58, 1: .62, 2: .55 },
    gnarliness: { 0: .024, 1: .045, 2: .055, 3: .018 },
    force: { strength: -.028 },
  }, { angle: 26, count: 12, start: .18, size: 2.45, sizeVariance: .28 }, { x: 1, y: 3.8 }),

  'Sugar Maple': species('sugar-maple', 26944, TreeType.Deciduous, {
    levels: 3,
    length: { 0: 13.5, 1: 11, 2: 6, 3: 3.8 },
    children: { 0: 9, 1: 4, 2: 3 },
    angle: { 1: 68, 2: 67, 3: 44 },
    start: { 1: .36, 2: .21, 3: .25 },
    radius: { 0: 1.2, 1: .56, 2: .47, 3: .43 },
    gnarliness: { 0: .065, 1: .16, 2: .11, 3: .06 },
    force: { strength: .027 },
  }, { angle: 52, count: 12, start: .05, size: 2.15, sizeVariance: .41 }, { x: 1, y: 3.6 }),

  Ginkgo: species('ginkgo', 63279, TreeType.Deciduous, {
    levels: 2,
    length: { 0: 24, 1: 12.5, 2: 6 },
    children: { 0: 12, 1: 4 },
    angle: { 1: 22, 2: 41 },
    start: { 1: .22, 2: .38 },
    radius: { 0: 1.04, 1: .47, 2: .39 },
    taper: { 0: .64, 1: .52 },
    gnarliness: { 0: .017, 1: .031, 2: .063 },
    force: { strength: .012 },
  }, { angle: 49, count: 13, start: .08, size: 2.35, sizeVariance: .44 }, { x: 1, y: 3.5 }),

  'Blue Spruce': species('blue-spruce', 38551, TreeType.Evergreen, {
    levels: 2,
    length: { 0: 29, 1: 12, 2: 5.5 },
    children: { 0: 40, 1: 4 },
    angle: { 1: 94, 2: 47 },
    start: { 1: .12, 2: .12 },
    radius: { 0: .94, 1: .31, 2: .36 },
    gnarliness: { 0: .007, 1: .026, 2: .039 },
    force: { strength: .005 },
  }, { angle: 43, count: 11, start: .04, size: 1.95, sizeVariance: .4 }, { x: 1, y: 3.7 }),

  'Coast Redwood': species('coast-redwood', 31072, TreeType.Evergreen, {
    levels: 2,
    sections: { 0: 20, 1: 10, 2: 7 },
    segments: { 0: 16, 1: 8, 2: 5 },
    length: { 0: 71, 1: 33, 2: 9 },
    children: { 0: 46, 1: 4 },
    angle: { 1: 77, 2: 59 },
    start: { 1: .49, 2: .19 },
    radius: { 0: 4.1, 1: .24, 2: .43 },
    gnarliness: { 0: .006, 1: .073, 2: .034 },
    force: { strength: .016 },
  }, { angle: 42, count: 11, start: .1, size: 3.55, sizeVariance: .47 }, { x: 1, y: 2.9 }),

  'Lebanon Cedar': species('lebanon-cedar', 63405, TreeType.Evergreen, {
    levels: 2,
    length: { 0: 17, 1: 27, 2: 9.5 },
    children: { 0: 18, 1: 6 },
    angle: { 1: 83, 2: 57 },
    start: { 1: .28, 2: .18 },
    radius: { 0: 1.52, 1: .48, 2: .4 },
    gnarliness: { 0: .064, 1: .065, 2: .07 },
    force: { strength: .003 },
  }, { angle: 54, count: 13, start: .12, size: 2.35, sizeVariance: .36 }, { x: 1, y: 3.2 }),

  'Fan Palm': species('fan-palm', 10946, TreeType.Deciduous, {
    levels: 0,
    length: { 0: 11.4 },
    radius: { 0: .65 },
    taper: { 0: .21 },
    sections: { 0: 20 },
    segments: { 0: 12 },
    gnarliness: { 0: .017 },
    force: { direction: { x: .3, y: .8, z: -.18 }, strength: .019 },
  }, {
    billboard: Billboard.Single,
    angle: 63,
    angleVariance: 37,
    count: 22,
    start: .93,
    size: 4.4,
    sizeVariance: .35,
    roundedNormals: false,
  }, { x: 1, y: 2.4 }),
};
