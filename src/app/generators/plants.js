import * as THREE from 'three';
import { EXTRA_PLANT_FORMS, EXTRA_PLANT_DEFAULTS, buildPlantForm } from './plant-forms.js';

/** Original botanical meshes with serializable PBR material descriptors. No DOM, renderer, or source assets required. */
export const PLANT_ARCHETYPES = Object.freeze(['shrub', 'bush', 'sapling', 'fern', 'weed', 'groundCover', 'flower', ...EXTRA_PLANT_FORMS]);
export const LEAF_DESIGNS = Object.freeze(['oval', 'serrated', 'lobed', 'heart', 'lanceolate', 'trifoliate', 'fernPinna', 'coniferNeedle', 'cushionScale', 'grassBlade', 'succulent']);
export const PLANT_BARK_TYPES = Object.freeze(['Bark001', 'Bark002', 'Bark003', 'Bark004', 'Bark006', 'Bark007', 'Bark008', 'Bark012', 'Bark013', 'Bark014', 'Bark015']);
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.399963229728653;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const defaults = {
  shrub: { height: 1.35, width: 1.55, branches: 9, stemCount: 5, leafSize: .115, density: 1.25, leafColor: '#587939', leafDesign: 'lobed', barkType: 'Bark006' },
  bush: { height: .9, width: 1.9, branches: 11, stemCount: 7, leafSize: .14, density: 1.15, leafColor: '#758c46', leafDesign: 'serrated', barkType: 'Bark008' },
  sapling: { height: 2.4, width: 1.25, branches: 10, stemCount: 1, leafSize: .14, density: 1, leafColor: '#7b9644', leafDesign: 'heart', barkType: 'Bark002' },
  fern: { height: .8, width: 1.25, branches: 10, stemCount: 10, leafSize: .1, density: 1.15, leafColor: '#548147', leafDesign: 'fernPinna', barkType: 'Bark012' },
  weed: { height: .7, width: .55, branches: 7, stemCount: 5, leafSize: .12, density: 1, leafColor: '#859052', leafDesign: 'lanceolate', barkType: 'Bark014' },
  groundCover: { height: .24, width: 1.15, branches: 8, stemCount: 12, leafSize: .16, density: 1.2, leafColor: '#6a8544', leafDesign: 'oval', barkType: 'Bark007' },
  flower: { height: .7, width: .7, branches: 5, stemCount: 5, leafSize: .12, density: 1, leafColor: '#698646', leafDesign: 'lanceolate', barkType: 'Bark002' },
};

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = Math.imul(state ^ state >>> 15, state | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function numeric(value, key, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Plant ${key} must be a finite number.`);
  const result = Math.max(min, Math.min(max, value));
  return integer ? Math.round(result) : result;
}

function color(value, key) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, '0')}`;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError(`Plant ${key} must be a six-digit hex color.`);
  return value.toLowerCase();
}

export function createPlantDefinition(archetype = 'shrub', overrides = {}) {
  if (!PLANT_ARCHETYPES.includes(archetype)) throw new TypeError(`Unknown plant archetype: ${archetype}`);
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('Plant overrides must be an object.');
  if (overrides.version !== undefined && overrides.version !== 1) throw new TypeError(`Unsupported plant definition version: ${overrides.version}`);
  const d = {
    version: 1, seed: 18427, archetype, height: 1, width: 1, density: 1,
    branches: 8, stemCount: 5, leafSize: .12, curvature: .65, asymmetry: .35,
    stemColor: '#ffffff', leafColor: '#698446', flowerColor: '#e7bf66', leafDesign: 'oval', barkType: 'Bark004',
    flowerCount: 5, petalCount: 9, flowering: archetype === 'flower',
    ...defaults[archetype], ...EXTRA_PLANT_DEFAULTS[archetype], ...overrides, archetype,
  };
  const legacyLeafDesign = d.leafShape === 'clover' ? 'trifoliate' : d.leafShape === 'lance' ? 'lanceolate' : undefined;
  const leafDesign = overrides.leafDesign === undefined && legacyLeafDesign ? legacyLeafDesign : d.leafDesign;
  if (!LEAF_DESIGNS.includes(leafDesign)) throw new TypeError(`Unknown plant leafDesign: ${leafDesign}`);
  if (!PLANT_BARK_TYPES.includes(d.barkType)) throw new TypeError(`Unknown plant barkType: ${d.barkType}`);
  const result = {
    version: 1, seed: numeric(d.seed, 'seed', -2147483648, 4294967295, true) >>> 0, archetype,
    height: numeric(d.height, 'height', .05, 8), width: numeric(d.width, 'width', .05, 8),
    density: numeric(d.density, 'density', .1, 2.5), branches: numeric(d.branches, 'branches', 1, 20, true),
    stemCount: numeric(d.stemCount, 'stemCount', 1, 16, true), leafSize: numeric(d.leafSize, 'leafSize', .015, .7),
    curvature: numeric(d.curvature, 'curvature', 0, 2), asymmetry: numeric(d.asymmetry, 'asymmetry', 0, 1),
    // The pre-bark placeholder stem ('stem' + #705b3d) upgrades to photographed
    // bark; other authored stem colors stay on as the bark tint.
    stemColor: color(d.stemMaterial === 'stem' && d.stemColor === '#705b3d' ? '#ffffff' : d.stemColor, 'stemColor'), leafColor: color(d.leafColor, 'leafColor'), flowerColor: color(d.flowerColor, 'flowerColor'),
    flowerCount: numeric(d.flowerCount, 'flowerCount', 1, 16, true), petalCount: numeric(d.petalCount, 'petalCount', 4, 16, true),
    flowering: Boolean(d.flowering), leafDesign, barkType: d.barkType,
    stemMaterial: d.stemMaterial === 'stem' ? 'bark' : (d.stemMaterial ?? 'bark'),
    leafMaterial: d.leafMaterial ?? 'foliage', petalMaterial: d.petalMaterial ?? 'petal',
    textureScale: numeric(d.textureScale ?? 1, 'textureScale', .05, 20),
  };
  for (const key of ['stemMaterial','leafMaterial','petalMaterial']) if (!['bark','stem','foliage','petal','pollen'].includes(result[key])) throw new TypeError(`Unknown plant ${key}.`);
  if(archetype==='grass') {
    if(typeof d.seedHeads!=='boolean')throw new TypeError('Plant seedHeads must be boolean.');
    result.seedHeads=d.seedHeads;result.bladeWidth=numeric(d.bladeWidth,'bladeWidth',.005,.12);
  }
  if(archetype==='cactus')result.armCount=numeric(d.armCount,'armCount',0,6,true);
  if(d.leafShape!==undefined&&!['lance','clover'].includes(d.leafShape))throw new TypeError('Unknown plant leafShape.');
  // Preserve extension metadata through JSON round trips without making it executable.
  for (const key of Object.keys(overrides).sort()) {
    if (!(key in result) && key !== 'leafShape' && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      const extra = overrides[key];
      if (extra === null || ['string', 'boolean'].includes(typeof extra) || typeof extra === 'number' && Number.isFinite(extra)) result[key] = extra;
    }
  }
  return result;
}

function hashDefinition(definition) {
  let hash = 2166136261;
  for (const char of JSON.stringify(definition)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `plant-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const presets = [
  ['woodland-shrub', 'Woodland shrub', 'shrub', { leafDesign: 'lobed', barkType: 'Bark006' }],
  ['boxwood', 'Dense boxwood', 'shrub', { height: .95, width: 1.3, leafSize: .075, density: 1.8, stemCount: 7, leafColor: '#496638', leafDesign: 'oval', barkType: 'Bark008', seed: 410 }],
  ['meadow-bush', 'Spreading meadow bush', 'bush', { leafDesign: 'serrated', barkType: 'Bark012' }],
  ['copper-bush', 'Copperleaf bush', 'bush', { leafColor: '#a76c43', leafDesign: 'heart', barkType: 'Bark015', height: 1.2, width: 1.8, seed: 442 }],
  ['young-birch', 'Young woodland sapling', 'sapling', { leafDesign: 'heart', barkType: 'Bark002', seed: 925 }],
  ['bush-1', 'Bush 1', 'shrub', { seed: 7201, height: 1.25, width: 1.55, branches: 8, stemCount: 6, density: 1.35, leafSize: .1, leafDesign: 'serrated', barkType: 'Bark001', leafColor: '#54743d' }],
  ['bush-2', 'Bush 2', 'bush', { seed: 7202, height: 1.05, width: 2.05, branches: 10, stemCount: 7, density: 1.2, leafSize: .13, leafDesign: 'heart', barkType: 'Bark013', leafColor: '#718849' }],
  ['bush-3', 'Bush 3', 'bush', { seed: 7203, height: 1.35, width: 1.8, branches: 10, stemCount: 7, density: 1.35, leafSize: .065, leafDesign: 'coniferNeedle', barkType: 'Bark003', leafColor: '#3f6444' }],
  ['forest-fern', 'Forest fern', 'fern', {}],
  ['bracken', 'Tall bracken', 'fern', { height: 1.05, width: 1.55, stemCount: 7, leafColor: '#829645', curvature: 1.15, seed: 518, barkType: 'Bark013' }],
  ['wild-weed', 'Wild meadow weed', 'weed', { flowering: true, flowerColor: '#cbb994', leafDesign: 'lanceolate' }],
  ['rosette-carpet', 'Rosette ground cover', 'groundCover', { leafDesign: 'lobed' }],
  ['silver-groundcover', 'Silver ground cover', 'groundCover', { leafColor: '#98a595', leafDesign: 'lanceolate', height: .16, width: .95, seed: 221, barkType: 'Bark015' }],
  ['golden-daisy', 'Golden field daisies', 'flower', { leafDesign: 'serrated' }],
  ['white-daisy', 'White meadow daisies', 'flower', { flowerColor: '#f0ead8', petalCount: 12, leafDesign: 'lanceolate', height: .65, seed: 337, barkType: 'Bark004' }],
  ['purple-wildflower', 'Purple wildflowers', 'flower', { flowerColor: '#9c7bb5', petalCount: 6, leafColor: '#6b8567', leafDesign: 'oval', seed: 135, barkType: 'Bark001' }],
  ['berry-thicket', 'Berry Thicket', 'bush', {seed:7101,height:1.1,width:1.9,branches:5,stemCount:4,density:.65,leafSize:.1,leafDesign:'serrated',barkType:'Bark007',flowering:true,flowerColor:'#ead9d4',petalCount:5}],
  ['wood-sorrel', 'Wood Sorrel Carpet', 'groundCover', {seed:7102,height:.18,width:.85,stemCount:8,branches:3,density:.6,leafSize:.12,leafDesign:'trifoliate',flowering:true,flowerColor:'#f1e9d8',barkType:'Bark008'}],
  ['moss-cushion', 'Moss Cushion', 'cushion', {seed:7103,height:.12,width:.75,leafSize:.035}],
  ['young-pine', 'Young Pine', 'coniferSapling', {seed:7104}],
  ['fallen-log', 'Fallen Log', 'deadwood', {seed:7105}],
  ['short-meadow-grass', 'Short Meadow Grass', 'grass', {seed:7106,height:.32,width:.45,bladeWidth:.025,stemCount:12}],
  ['tall-seed-grass', 'Tall Seed Grass', 'grass', {seed:7107,height:1.15,width:.7,seedHeads:true,flowerColor:'#bea56a',stemCount:10,barkType:'Bark012'}],
  ['clover-groundcover', 'Clover Groundcover', 'groundCover', {seed:7108,height:.2,width:1.1,leafDesign:'trifoliate',leafSize:.16,stemCount:9,branches:3,density:.65,leafColor:'#52834b',flowering:true,flowerColor:'#ece3cf',barkType:'Bark006'}],
  ['sagebrush', 'Sagebrush', 'shrub', {seed:7109,height:.85,width:1.35,branches:4,stemCount:4,density:.35,leafSize:.06,leafDesign:'lanceolate',barkType:'Bark014',leafColor:'#98a18b'}],
  ['dry-bunchgrass', 'Dry Bunchgrass', 'grass', {seed:7110,height:.65,width:.65,stemCount:14,bladeWidth:.018,leafColor:'#b1a16c',curvature:1.5,barkType:'Bark014'}],
  ['saguaro-cactus', 'Saguaro Cactus', 'cactus', {seed:7111,armCount:3}],
  ['agave-rosette', 'Agave Rosette', 'succulent', {seed:7112}],
  ['alpine-grass-tuft', 'Alpine Grass Tuft', 'grass', {seed:7113,height:.28,width:.5,stemCount:16,bladeWidth:.018,leafColor:'#7c8257',curvature:1.6,barkType:'Bark002'}],
  ['heather-cushion', 'Heather Cushion', 'cushion', {seed:7114,height:.42,width:1,leafSize:.07,branches:7,flowering:true,flowerColor:'#ad829e',barkType:'Bark003'}],
];
const plantGroups={Forest:['woodland-shrub','boxwood','young-birch','bush-1','bush-2','bush-3','forest-fern','bracken','berry-thicket','wood-sorrel','moss-cushion','young-pine','fallen-log'],Meadow:['meadow-bush','copper-bush','wild-weed','rosette-carpet','golden-daisy','white-daisy','purple-wildflower','short-meadow-grass','tall-seed-grass','clover-groundcover'],Arid:['sagebrush','dry-bunchgrass','saguaro-cactus','agave-rosette'],Rocky:['silver-groundcover','alpine-grass-tuft','heather-cushion']};
export const PLANT_PRESETS = Object.freeze(presets.map(([id, name, archetype, overrides]) => Object.freeze({
  id, name, group:Object.keys(plantGroups).find(g=>plantGroups[g].includes(id))||'General',
  layer:archetype==='grass'?'grass':archetype==='flower'?'flowers':'plants',
  biomes:Object.freeze([({Forest:'forest',Meadow:'meadow',Arid:'desert',Rocky:'rocky'})[Object.keys(plantGroups).find(g=>plantGroups[g].includes(id))]].filter(Boolean)),
  definition: Object.freeze(createPlantDefinition(archetype, overrides)),
})));

function curvedPath(start, end, bend, steps = 8) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return start.clone().lerp(end, t).addScaledVector(bend, Math.sin(Math.PI * t));
  });
}

function samplePath(points, t) {
  const p = Math.min(points.length - 1.000001, Math.max(0, t) * (points.length - 1));
  const i = Math.floor(p);
  return points[i].clone().lerp(points[i + 1], p - i);
}

function botanicalModel(d) {
  const random = rng(d.seed);
  const range = (a, b) => a + random() * (b - a);
  const model = { stems: [], leaves: [], petals: [], centers: [] };
  const addStem = (points, radius, rank = 0) => { model.stems.push({ points, radius, rank }); return points; };
  const addLeaf = (position, direction, length, width, twist = 0, fold = .1) => {
    if(d.leafDesign==='trifoliate'){
      const tip=position.clone().addScaledVector(direction.clone().normalize(),length*.45);
      for(let i=0;i<3;i++)model.leaves.push({position:tip.clone(),direction:direction.clone().applyAxisAngle(V(0,1,0),(i-1)*1.35).normalize(),length:length*.55,width:length*.52,twist,fold,tint:range(.82,1.17),design:'oval'});
    } else model.leaves.push({ position, direction: direction.normalize(), length, width, twist, fold, tint: range(.82, 1.17), design: d.leafDesign });
  };
  const radial = (angle, radius, y = 0) => V(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  const flower = (position, size, tilt, petals = d.petalCount) => {
    const normal = V(tilt.x, 1, tilt.z).normalize();
    const axis = V(1, -normal.x / Math.max(.1, normal.y), 0).normalize();
    const other = V().crossVectors(normal, axis).normalize();
    const offset = random() * TAU;
    for (let i = 0; i < petals; i++) {
      const a = offset + i / petals * TAU;
      const direction = axis.clone().multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a)).addScaledVector(normal, -.12).normalize();
      model.petals.push({ position: position.clone().addScaledVector(direction, size * .17), direction,
        length: size * range(.83, 1.07), width: size * .30, twist: 0, fold: .16, tint: range(.91, 1.07), normal });
    }
    model.centers.push({ position: position.clone().addScaledVector(normal, size * .07), radius: size * .23, normal });
  };

  if(buildPlantForm(d,{range,addStem,addLeaf,radial,curvedPath,flower,model}))return model;
  if (['shrub', 'bush', 'sapling'].includes(d.archetype)) {
    const sapling = d.archetype === 'sapling';
    const count = sapling ? Math.min(3, d.stemCount) : d.stemCount;
    for (let stem = 0; stem < count; stem++) {
      const a = stem * GOLDEN_ANGLE + range(-.25, .25);
      const start = radial(a, sapling ? .01 * stem : range(.025, .13));
      const spread = sapling ? .035 : range(.15, .36);
      const end = radial(a, spread, sapling ? range(.9, 1.0) : range(.66, .91));
      end.x += d.asymmetry * .13;
      const main = addStem(curvedPath(start, end, radial(a + .5, d.curvature * .08)), sapling ? .021 : .013, 0);
      const branchCount = d.branches;
      for (let b = 0; b < branchCount; b++) {
        const t = .22 + b / Math.max(1, branchCount - 1) * .7;
        const origin = samplePath(main, t);
        const theta = a + b * GOLDEN_ANGLE + range(-.3, .3);
        const crown = Math.sin(t * Math.PI) ** .65;
        const outward = (sapling ? .32 : .38) * crown * range(.7, 1.15);
        const target = origin.clone().add(radial(theta, outward, range(.1, .22)));
        const branch = addStem(curvedPath(origin, target, V(0, d.curvature * .075, 0)), .0048 * (1.18 - .5 * t), 1);
        const shoots = 2 + Math.round(d.density * 2);
        for (let shoot = 0; shoot < shoots; shoot++) {
          const along = .28 + shoot / Math.max(1, shoots - 1) * .7;
          const p = samplePath(branch, along);
          const azimuth = theta + (shoot % 2 ? 1 : -1) * range(.55, 1.1);
          const tip = p.clone().add(radial(azimuth, range(.075, .15), range(.045, .15)));
          const twig = addStem(curvedPath(p, tip, V(0, .025 * d.curvature, 0), 4), .0018, 2);
          const leaves = Math.max(3, Math.round(d.density * 5));
          for (let l = 0; l < leaves; l++) {
            const lt = .2 + l / Math.max(1, leaves - 1) * .8;
            const leafAngle = azimuth + l * GOLDEN_ANGLE;
            const length = d.leafSize * range(.67, 1.15);
            addLeaf(samplePath(twig, lt), radial(leafAngle, 1, range(.15, .75)), length, length * (sapling ? .57 : .67), range(-.6, .6));
          }
        }
        const tipLength = d.leafSize * 1.05;
        addLeaf(target, radial(theta, 1, .5), tipLength, tipLength * .6);
        if (d.flowering && b % 3 === 0) flower(target, d.leafSize * .6, radial(theta, .35), Math.min(d.petalCount, 8));
      }
      addLeaf(end, radial(a, .3, 1), d.leafSize, d.leafSize * .55);
    }
  } else if (d.archetype === 'fern') {
    for (let f = 0; f < d.stemCount; f++) {
      const a = f * GOLDEN_ANGLE + range(-.13, .13);
      const outer = f % 3 !== 0;
      const reach = outer ? range(.42, .6) : range(.17, .38);
      const length = outer ? range(.43, .67) : range(.64, .85);
      const start = radial(a, range(.015, .04));
      const end = radial(a, reach, length * .44);
      const points = curvedPath(start, end, radial(a, -.035, length * (.38 + d.curvature * .27)), 12);
      addStem(points, .0045, 0);
      const pairs = Math.round(9 + d.branches * .6 + d.density * 4);
      for (let i = 0; i < pairs; i++) {
        const t = .16 + i / pairs * .82;
        const centre = samplePath(points, t);
        const envelope = Math.sin(Math.PI * t) ** .85 * (1 - t * .4);
        for (const sign of [-1, 1]) {
          const theta = a + sign * 1.13;
          const bladeLength = (.11 + d.leafSize * .7) * envelope * range(.88, 1.08);
          const direction = radial(theta, 1, .05 + .22 * (1 - t));
          addLeaf(centre.clone().add(radial(a, sign * .002)), direction, bladeLength, bladeLength * .25, sign * .1, .05);
        }
      }
      addLeaf(end, radial(a, 1, -.15), .07, .023, 0, .05);
    }
  } else if (d.archetype === 'groundCover') {
    for (let crown = 0; crown < d.stemCount; crown++) {
      const a = crown * GOLDEN_ANGLE;
      const radius = crown === 0 ? 0 : Math.sqrt(crown / d.stemCount) * .45;
      const centre = radial(a, radius, range(.005, .018));
      if (crown) addStem(curvedPath(V(0, .003, 0), centre, V(0, .008, 0), 3), .003, 1);
      const leaves = Math.round(5 + d.branches * .4 + d.density * 3);
      for (let i = 0; i < leaves; i++) {
        const angle = a + i * GOLDEN_ANGLE;
        const inner = i > leaves * .64;
        const length = d.leafSize * range(.8, 1.3) * (inner ? .68 : 1);
        addLeaf(centre, radial(angle, 1, inner ? 1.1 : range(.18, .5)), length, length * .53, range(-.3, .3), .16 + d.curvature * .06);
      }
      if (d.flowering && crown % 2 === 0) {
        const tip = centre.clone().add(V(0, .12, 0));
        addStem(curvedPath(centre, tip, V(.01, 0, .01), 3), .0018, 1);
        flower(tip, .045, V(.15, 0, .1), 5);
      }
    }
  } else {
    const isFlower = d.archetype === 'flower';
    const count = isFlower ? d.flowerCount : d.stemCount;
    for (let stem = 0; stem < count; stem++) {
      const a = stem * GOLDEN_ANGLE + range(-.15, .15);
      const root = radial(a, stem === 0 ? 0 : range(.025, .11));
      const end = radial(a, range(.05, .22), range(.55, .95));
      const main = addStem(curvedPath(root, end, radial(a + .7, d.curvature * .055)), isFlower ? .005 : .004, 0);
      const leaves = Math.round(3 + d.branches * .5 + d.density * 2);
      for (let l = 0; l < leaves; l++) {
        const t = .09 + l / leaves * .66;
        const angle = a + l * GOLDEN_ANGLE;
        const length = d.leafSize * (1 - t * .55) * range(.8, 1.2);
        const p = samplePath(main, t);
        addLeaf(p, radial(angle, 1, range(.3, .7)), length, length * (isFlower ? .3 : .44), range(-.3, .3));
        if (!isFlower && l % 3 === 0) {
          const target = p.clone().add(radial(angle, .1, .14));
          const twig = addStem(curvedPath(p, target, V(0, .025, 0), 4), .0018, 1);
          addLeaf(samplePath(twig, .45), radial(angle - .8, 1, .4), length * .8, length * .32);
          addLeaf(target, radial(angle, .7, 1), length * .65, length * .28);
          if (d.flowering) flower(target, .027, radial(angle, .1), 5);
        }
      }
      if (isFlower || d.flowering) flower(end, isFlower ? .075 + d.leafSize * .35 : .035, radial(a, range(.05, .4)));
      else addLeaf(end, radial(a, .3, 1), d.leafSize * .6, d.leafSize * .19);
    }
  }
  return model;
}

class GeometryBatch {
  constructor() { this.positions = []; this.indices = []; this.uvs = []; this.weights = []; this.colors = []; }
  vertex(p, u, v, weight, tint = 1) {
    const index = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z); this.uvs.push(u, v);
    this.weights.push(Math.max(0, Math.min(1, weight))); this.colors.push(tint, tint, tint);
    return index;
  }
  triangle(a, b, c) { this.indices.push(a, b, c); }
  geometry() {
    if (!this.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('windWeight', new THREE.Float32BufferAttribute(this.weights, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

function meshStem(batch, stem, level, preview = false, endBatch = null, bark = false) {
  const sections = stem.rounded?(preview?[16,10,6]:[24,14,8])[level]:Math.max(2, Math.round((stem.points.length - 1) / (preview ? [1.5, 2.5, 4] : [1, 1.8, 3])[level]));
  const sides = (stem.rounded?(preview?[12,8,4]:[16,10,6]):preview ? [6, 4, 3] : [7, 5, 3])[level];
  const base = batch.positions.length / 3;
  const paths = Array.from({ length: sections + 1 }, (_, i) => samplePath(stem.points, i / sections));
  // Use the same source-path distances at every LOD. Thin twigs sample a small
  // strip of bark instead of squeezing an entire photograph around each tube.
  const distances = [0];
  for (let i = 1; i < stem.points.length; i++) distances.push(distances[i - 1] + stem.points[i].distanceTo(stem.points[i - 1]));
  const barkTile = .18, circumference = TAU * stem.radius;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const pathIndex = t * (stem.points.length - 1), segment = Math.min(stem.points.length - 2, Math.floor(pathIndex));
    const distance = THREE.MathUtils.lerp(distances[segment], distances[segment + 1], pathIndex - segment);
    const tangent = paths[Math.min(sections, i + 1)].clone().sub(paths[Math.max(0, i - 1)]).normalize();
    const axis = Math.abs(tangent.y) < .95 ? V(0, 1, 0) : V(1, 0, 0);
    const normal = V().crossVectors(tangent, axis).normalize();
    const binormal = V().crossVectors(tangent, normal).normalize();
    const cap=stem.rounded?Math.sqrt(Math.max(.002,1-Math.max(0,(t-.83)/.17)**2)):1;
    const radius = stem.radius * (1 - (stem.taper??.83) * t)*cap;
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * TAU;
      const rib=stem.rounded?(s%2?.96:1.04):1;
      const p = paths[i].clone().addScaledVector(normal, Math.cos(a) * radius*rib).addScaledVector(binormal, Math.sin(a) * radius*rib);
      batch.vertex(p, bark ? s / sides * circumference / barkTile : s / sides, bark ? distance / barkTile : t, Math.min(.65, Math.max(0, p.y) * .55), .92 + t * .12);
    }
  }
  for (let i = 0; i < sections; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * (sides + 1) + s, b = a + 1;
    batch.triangle(a, b, a + sides + 1); batch.triangle(b, b + sides + 1, a + sides + 1);
  }
  if (endBatch) {
    // Independent planar UVs and vertices keep the cut grain circular and the rim sharp.
    for (const end of [0, sections]) {
      const center = endBatch.vertex(paths[end], .5, .5, 0);
      const ring = [];
      for (let s = 0; s < sides; s++) {
        const offset = (base + end * (sides + 1) + s) * 3;
        ring.push(endBatch.vertex(V(...batch.positions.slice(offset, offset + 3)),
          .5 + Math.cos(s / sides * TAU) * .48, .5 + Math.sin(s / sides * TAU) * .48, 0));
      }
      for (let s = 0; s < sides; s++) {
        if (end === 0) endBatch.triangle(center, ring[(s + 1) % sides], ring[s]);
        else endBatch.triangle(center, ring[s], ring[(s + 1) % sides]);
      }
    }
    return;
  }
  const bottom = batch.vertex(paths[0], .5, 0, 0), top = batch.vertex(paths[sections], .5, 1, paths[sections].y * .55);
  for (let s = 0; s < sides; s++) {
    batch.triangle(bottom, base + (s + 1) % sides, base + s);
    batch.triangle(top, base + sections * (sides + 1) + s, base + sections * (sides + 1) + s + 1);
  }
}

function leafOutline(design, level) {
  const mirrored = left => [...left, ...left.slice(1, -1).reverse().map(([t, u]) => [t, -u])];
  if (design === 'petal') return level === 0 ? mirrored([[0, 0], [.2, -.65], [.52, -1], [.82, -.65], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.38, -1], [.78, -.7], [1, 0]]) : mirrored([[0, 0], [.5, -1], [1, 0]]);
  if (design === 'serrated') return level === 0 ? mirrored([[0, 0], [.18, -.52], [.31, -.78], [.44, -.58], [.59, -1], [.76, -.68], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.2, -.62], [.38, -.82], [.52, -.7], [.68, -1], [.82, -.61], [1, 0]]) : mirrored([[0, 0], [.42, -1], [.7, -.72], [1, 0]]);
  if (design === 'lobed') return level === 0 ? mirrored([[0, 0], [.18, -.78], [.34, -.46], [.5, -1], [.68, -.5], [.82, -.76], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.22, -.76], [.38, -.48], [.56, -1], [.72, -.54], [1, 0]]) : mirrored([[0, 0], [.3, -.88], [.55, -.52], [.78, -.72], [1, 0]]);
  if (design === 'heart') return level === 0 ? mirrored([[0, 0], [.08, -.6], [.2, -1], [.38, -.92], [.62, -.66], [.82, -.34], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.16, -.92], [.4, -1], [.7, -.58], [1, 0]]) : mirrored([[0, 0], [.24, -1], [.58, -.78], [1, 0]]);
  if (design === 'lanceolate') return level === 0 ? mirrored([[0, 0], [.2, -.45], [.48, -.72], [.75, -.52], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.42, -.7], [.76, -.5], [1, 0]]) : mirrored([[0, 0], [.52, -.62], [1, 0]]);
  if (design === 'fernPinna') return level === 0 ? mirrored([[0, 0], [.1, -.3], [.3, -.52], [.7, -.42], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.38, -.48], [.72, -.38], [1, 0]]) : mirrored([[0, 0], [.55, -.4], [1, 0]]);
  if (design === 'coniferNeedle') return level === 0 ? mirrored([[0, 0], [.08, -.35], [.72, -.3], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.42, -.3], [.78, -.24], [1, 0]]) : mirrored([[0, 0], [.55, -.28], [1, 0]]);
  if (design === 'cushionScale') return level === 0 ? mirrored([[0, 0], [.12, -.74], [.42, -1], [.72, -.7], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.32, -1], [.72, -.64], [1, 0]]) : mirrored([[0, 0], [.38, -.88], [1, 0]]);
  if (design === 'grassBlade') return level === 0 ? mirrored([[0, 0], [.12, -.72], [.7, -.55], [.92, -.24], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.5, -.56], [.88, -.25], [1, 0]]) : mirrored([[0, 0], [.65, -.46], [1, 0]]);
  if (design === 'succulent') return level === 0 ? mirrored([[0, 0], [.12, -.58], [.38, -1], [.7, -.82], [.9, -.34], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.4, -1], [.75, -.7], [1, 0]]) : mirrored([[0, 0], [.5, -.86], [1, 0]]);
  return level === 0 ? mirrored([[0, 0], [.2, -.65], [.52, -1], [.82, -.65], [1, 0]])
    : level === 1 ? mirrored([[0, 0], [.38, -1], [.78, -.7], [1, 0]]) : mirrored([[0, 0], [.5, -1], [1, 0]]);
}

function meshBlade(batch, leaf, level, sizeScale = 1, petal = false) {
  const direction = leaf.direction;
  let normal = leaf.normal?.clone() || V(0, 1, 0);
  if (Math.abs(normal.dot(direction)) > .95) normal = V(0, 0, 1);
  const side = V().crossVectors(direction, normal).normalize().applyAxisAngle(direction, leaf.twist);
  normal = V().crossVectors(side, direction).normalize();
  const length = leaf.length * sizeScale, width = leaf.width * sizeScale;
  const shape = leafOutline(petal ? 'petal' : leaf.design, level);
  const point = (t, u) => leaf.position.clone().addScaledVector(direction, t * length)
    .addScaledVector(side, u * width * .5).addScaledVector(normal, Math.sin(t * Math.PI) * length * leaf.fold * (1 - Math.abs(u) * .6));
  const centre = batch.vertex(point(.5, 0), .5, .5, .55 + Math.max(0, leaf.position.y) * .5, leaf.tint * 1.035);
  const edge = shape.map(([t, u]) => {
    const tt = petal && t > .7 ? .85 + (t - .7) * .5 : t;
    return batch.vertex(point(tt, u), (u + 1) / 2, t, .65 + Math.max(0, leaf.position.y) * .5, leaf.tint * (1 - t * .075));
  });
  for (let i = 0; i < edge.length; i++) batch.triangle(centre, edge[i], edge[(i + 1) % edge.length]);
}

function meshCenter(batch, flower, level) {
  const segments = [12, 8, 5][level];
  const normal = flower.normal;
  const axis = V(1, -normal.x / Math.max(.1, normal.y), 0).normalize();
  const other = V().crossVectors(normal, axis).normalize();
  const centre = batch.vertex(flower.position.clone().addScaledVector(normal, flower.radius * .48), .5, .5, 1);
  const lower = batch.vertex(flower.position.clone().addScaledVector(normal, -flower.radius * .1), .5, .5, 1);
  const rings = [];
  for (let i = 0; i < segments; i++) {
    const a = i / segments * TAU;
    const p = flower.position.clone().addScaledVector(axis, Math.cos(a) * flower.radius).addScaledVector(other, Math.sin(a) * flower.radius);
    rings.push(batch.vertex(p, .5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5, 1, i % 2 ? .93 : 1.06));
  }
  for (let i = 0; i < segments; i++) { batch.triangle(centre, rings[i], rings[(i + 1) % segments]); batch.triangle(lower, rings[(i + 1) % segments], rings[i]); }
}

/** Three unparented, separately exportable LOD groups with shared materials. */
export function generatePlant(definition = createPlantDefinition(), { quality = 'export' } = {}) {
  if (!definition || typeof definition !== 'object') throw new TypeError('A plant definition is required.');
  if (!['preview', 'export'].includes(quality)) throw new TypeError('Plant quality must be preview or export.');
  const d = createPlantDefinition(definition.archetype || 'shrub', definition);
  const preview = quality === 'preview';
  const model = botanicalModel(d);
  const definitionHash = hashDefinition(d);
  const materials = {
    stems: new THREE.MeshStandardMaterial({ name: 'Plant stems', color: d.stemColor, roughness: .92, vertexColors: true }),
    leaves: new THREE.MeshStandardMaterial({ name: 'Plant foliage', color: d.leafColor, roughness: .83, side: THREE.DoubleSide, vertexColors: true }),
    petals: new THREE.MeshStandardMaterial({ name: 'Flower petals', color: d.flowerColor, roughness: .72, side: THREE.DoubleSide, vertexColors: true }),
    centers: new THREE.MeshStandardMaterial({ name: 'Flower centers', color: '#b89438', roughness: .94, vertexColors: true }),
  };
  const wind=!['deadwood','cactus','succulent'].includes(d.archetype);
  const deadwood = d.archetype === 'deadwood';
  if (deadwood) materials.ends = new THREE.MeshStandardMaterial({ name: 'Wood cut ends', color: '#d5b991', roughness: .9, vertexColors: true });
  for (const [key, material] of Object.entries(materials)) material.userData = {
    pbrFamily: { stems:deadwood?'wood':d.stemMaterial, ends:'endgrain', leaves:d.leafMaterial, petals:d.petalMaterial, centers:'pollen' }[key],
    ...key === 'stems' && !deadwood && d.stemMaterial === 'bark' ? { pbrVariant: d.barkType } : {},
    ...key === 'leaves' && d.leafMaterial === 'foliage' ? { pbrVariant: d.leafDesign } : {},
    pbrTextureScale:key==='ends'?1:d.textureScale, vegetation: true, wind, windStrength: key === 'stems' ? .025 : .055, windAttribute: 'windWeight',
  };
  const lods = [0, 1, 2].map(level => {
    const group = new THREE.Group(); group.name = `lod${level}`;
    group.userData = { assetType: 'plant', archetype: d.archetype, definitionHash, lod: level, definition: structuredClone(d), wind };
    const batches = { stems: new GeometryBatch(), leaves: new GeometryBatch(), petals: new GeometryBatch(), centers: new GeometryBatch() };
    if (deadwood) batches.ends = new GeometryBatch();
    for (const stem of model.stems) if (level < 2 || stem.rank < 2) meshStem(batches.stems, stem, level, preview, batches.ends, !deadwood && d.stemMaterial === 'bark');
    const stride = (preview ? [2, 4, 8] : [1, 2, 4])[level];
    const bladeLevel = Math.min(2, level + (preview ? 1 : 0));
    model.leaves.forEach((leaf, i) => { if (i % stride === 0) meshBlade(batches.leaves, leaf, bladeLevel, [1, 1.16, 1.3][level]); });
    // Flower heads keep their petal arrangement so their silhouette remains readable at distance.
    for (const petal of model.petals) meshBlade(batches.petals, petal, bladeLevel, 1, true);
    for (const centre of model.centers) meshCenter(batches.centers, centre, bladeLevel);
    for (const [key, batch] of Object.entries(batches)) {
      const geometry = batch.geometry();
      if (!geometry) continue;
      if(!wind)geometry.attributes.windWeight.array.fill(0);
      const mesh = new THREE.Mesh(geometry, materials[key]); mesh.name = `${d.archetype}_${key}`;
      mesh.castShadow = level < 2; mesh.receiveShadow = true;
      mesh.userData = { materialSlot: key, wind, windAttribute: 'windWeight' }; group.add(mesh);
    }
    return group;
  });
  // Normalize all three levels against the full-detail model, preserving the same pivot and proportions.
  const bounds = new THREE.Box3().setFromObject(lods[0]);
  const size = bounds.getSize(V());
  const scaleXZ = d.width / Math.max(size.x, size.z, .00001), scaleY = d.height / Math.max(size.y, .00001);
  const center = bounds.getCenter(V());
  for (const group of lods) {
    group.traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) positions.setXYZ(i, (positions.getX(i) - center.x) * scaleXZ,
        Math.max(0, (positions.getY(i) - bounds.min.y) * scaleY), (positions.getZ(i) - center.z) * scaleXZ);
      positions.needsUpdate = true; object.geometry.computeVertexNormals(); object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
    });
    group.userData.triangles = group.children.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
    group.userData.bounds = new THREE.Box3().setFromObject(group).getSize(V()).toArray();
  }
  let disposed = false;
  return { object3D: lods[0], lods, definition: d, definitionHash, quality,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const group of lods) group.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
