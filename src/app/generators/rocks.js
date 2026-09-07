import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { slabGeometry, formationLayout, stoneSurface } from './rock-forms.js';

// All dimensions are meters. Definitions are data, so they can be saved without
// serializing a Three.js scene and regenerated identically on another machine.
export const ROCK_ARCHETYPES = Object.freeze(['pebble', 'rock', 'boulder', 'cluster', 'slab', 'outcrop']);
const ARCHETYPES = ROCK_ARCHETYPES;
const DEFAULTS = {
  slab: {width:2.2,height:.4,depth:1.5,roundness:.05,angularity:.95,flattening:.8,displacement:.15,color:'#b1ac91',flatShading:true,colliderMode:'box',strata:.7},
  outcrop: {width:5.6,height:3.5,depth:4,roundness:.06,angularity:.95,flattening:.5,displacement:.2,color:'#838480',flatShading:true,colliderMode:'box',strata:.2},
  pebble: {
    width: 0.16,
    height: 0.09,
    depth: 0.2,
    roundness: 0.9,
    angularity: 0.08,
    flattening: 0.5,
    displacement: 0.12,
    color: '#899096',
    colliderMode: 'none',
  },
  rock: {
    width: 1.1,
    height: 0.8,
    depth: 1,
    roundness: 0.45,
    angularity: 0.6,
    flattening: 0.3,
    displacement: 0.28,
    color: '#787d7a',
    colliderMode: 'box',
  },
  boulder: {
    width: 3.5,
    height: 2.6,
    depth: 3,
    roundness: 0.25,
    angularity: 0.75,
    flattening: 0.45,
    displacement: 0.35,
    color: '#777b79',
    colliderMode: 'box',
  },
  cluster: {
    width: 0.5,
    height: 0.32,
    depth: 0.55,
    roundness: 0.65,
    angularity: 0.35,
    flattening: 0.45,
    displacement: 0.2,
    color: '#828783',
    colliderMode: 'none',
  },
};

function finite(value, field, min, max, integer = false) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RangeError(
      `Rock ${field} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`,
    );
  }
  return value;
}

/** Create and validate a portable, versioned rock preset. */
export function createRockDefinition(archetype = 'rock', overrides = {}) {
  if (archetype && typeof archetype === 'object') {
    overrides = archetype;
    archetype = overrides.archetype ?? 'rock';
  }
  archetype = overrides.archetype ?? archetype;
  if (!ARCHETYPES.includes(archetype))
    throw new Error(`Unknown rock archetype: ${archetype}`);
  const result = {
    version: 1,
    seed: 18427,
    archetype,
    asymmetry: 0.35,
    frequency: 2.4,
    roughness: 0.88,
    flatShading: false,
    variation: 0.15,
    count: 18,
    clusterMix: 'mixed',
    radius: 2.4,
    spacing: 0.25,
    ...DEFAULTS[archetype],
    ...overrides,
  };
  if (result.version !== 1)
    throw new Error(`Unsupported rock preset version: ${result.version}`);
  finite(result.seed, 'seed', 0, 0xffffffff, true);
  for (const field of ['width', 'height', 'depth'])
    finite(result[field], field, 0.01, 200);
  for (const field of [
    'roundness',
    'angularity',
    'asymmetry',
    'flattening',
    'displacement',
    'roughness',
    'variation',
  ])
    finite(result[field], field, 0, 1);
  finite(result.frequency, 'frequency', 0.1, 12);
  finite(result.count, 'count', 1, 128, true);
  finite(result.radius, 'radius', 0.01, 100);
  finite(result.spacing, 'spacing', 0, 20);
  if (!['pebbles', 'mixed', 'outcrop', 'scree'].includes(result.clusterMix))
    throw new Error('Rock clusterMix must be pebbles, mixed, outcrop, or scree.');
  // Optional fields stay absent from legacy definitions, preserving their hashes.
  for(const key of ['strata','weatheringAmount'])if(result[key]!==undefined)finite(result[key],key,0,1);
  if(result.weatheringColor!==undefined&&!/^#[\da-f]{6}$/i.test(result.weatheringColor))throw new Error('Rock weatheringColor must be a six-digit hex color.');
  if (typeof result.flatShading !== 'boolean')
    throw new Error('Rock flatShading must be true or false.');
  if (!['none', 'box', 'sphere', 'convex'].includes(result.colliderMode))
    throw new Error('Rock colliderMode must be none, box, sphere, or convex.');
  if (
    typeof result.color === 'number' &&
    Number.isInteger(result.color) &&
    result.color >= 0 &&
    result.color <= 0xffffff
  ) {
    result.color = `#${result.color.toString(16).padStart(6, '0')}`;
  }
  if (typeof result.color !== 'string' || !/^#[\da-f]{6}$/i.test(result.color))
    throw new Error(
      'Rock color must be a six-digit hex color, for example #787d7a.',
    );
  result.color = result.color.toLowerCase();
  return result;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function definitionHash(definition) {
  let hash = 2166136261;
  for (const character of canonical(definition))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `rock-v1-${hash.toString(16).padStart(8, '0')}`;
}

// Indexed subdivision shares edge vertices. A positive radial displacement and
// monotone base compression preserve the closed topology even at valid extremes.
function sphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  const points = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => new THREE.Vector3(...p).normalize());
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10,
    2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5,
    2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let level = 0; level < subdivisions; level++) {
    const edges = new Map();
    const middle = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) return edges.get(key);
      const index = points.length;
      points.push(points[a].clone().add(points[b]).normalize());
      edges.set(key, index);
      return index;
    };
    const next = [];
    for (let i = 0; i < faces.length; i += 3) {
      const [a, b, c] = faces.slice(i, i + 3);
      const ab = middle(a, b),
        bc = middle(b, c),
        ca = middle(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return { points, faces };
}

function deformation(definition) {
  const rng = random(definition.seed);
  const phases = Array.from({ length: 12 }, () => rng() * Math.PI * 2);
  const planes = Array.from({ length: 10 }, () => {
    const normal = new THREE.Vector3(
      rng() * 2 - 1,
      rng() * 2 - 1,
      rng() * 2 - 1,
    ).normalize();
    return { normal, distance: 0.54 + rng() * 0.3 };
  });
  const noise = (point, frequency = 1) => {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    for (let i = 0; i < 3; i++) {
      const f = definition.frequency * frequency * 2 ** i;
      sum +=
        amplitude *
        Math.sin(point.x * f + phases[i * 3]) *
        Math.cos(point.y * f + phases[i * 3 + 1]) *
        Math.sin(point.z * f + phases[i * 3 + 2]);
      total += amplitude;
      amplitude *= 0.38;
    }
    return sum / total;
  };
  return {
    noise,
    apply(point) {
      let cut = 1;
      for (const plane of planes) {
        const dot = point.dot(plane.normal);
        if (dot > 0) cut = Math.min(cut, plane.distance / dot);
      }
      const angular =
        Math.min(1, definition.angularity * 1.6) *
        (1 - definition.roundness * 0.35);
      const displaced =
        1 +
        noise(point) *
          definition.displacement *
          (0.46 - definition.roundness * 0.15);
      // Clip the displaced radial surface toward support planes. Applying noise
      // before compression leaves recognizable broad fracture faces instead of
      // putting the same rounded noise back over every planar face.
      const radius =
        displaced + (Math.min(displaced, cut) - displaced) * angular;
      const position = point.clone().multiplyScalar(radius);
      position.x +=
        definition.asymmetry * 0.2 * position.y * Math.sin(phases[10]);
      position.z +=
        definition.asymmetry * 0.16 * position.y * Math.cos(phases[11]);
      // A positive-slope lower-region compression broadens the base while
      // preserving upper fracture planes and nonzero triangle area.
      if (position.y < -0.35)
        position.y =
          -0.35 + (position.y + 0.35) * (1 - definition.flattening * 0.65);
      return position;
    },
  };
}

function rockGeometry(definition, detail) {
  const { points, faces } = sphere(detail);
  const field = deformation(definition);
  const positions = points.map((p) => field.apply(p));
  const bounds = new THREE.Box3().setFromPoints(positions);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const attributes = [],
    colors = [],
    uvs = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    attributes.push(
      ((p.x - center.x) / size.x) * definition.width,
      ((p.y - bounds.min.y) / size.y) * definition.height,
      ((p.z - center.z) / size.z) * definition.depth,
    );
    const color =
      1 - definition.variation * (0.5 + field.noise(points[i], 2.7) * 0.5);
    colors.push(color, color, color);
    uvs.push(
      0.5 + Math.atan2(points[i].z, points[i].x) / (Math.PI * 2),
      0.5 + Math.asin(points[i].y) / Math.PI,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(faces);
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(attributes, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    generator: 'EZ Environment Rock Studio',
    seed: definition.seed,
    detail,
  };
  stoneSurface(geometry,definition);
  return geometry;
}

function layoutCluster(definition) {
  const rng = random(definition.seed ^ 0xa71f5279);
  const transforms = [];
  const limit = definition.count * 120;
  for (
    let attempt = 0;
    attempt < limit && transforms.length < definition.count;
    attempt++
  ) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * definition.radius;
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius;
    if (
      transforms.some(
        (other) => Math.hypot(other.x - x, other.z - z) < definition.spacing,
      )
    )
      continue;
    transforms.push({
      x,
      z,
      rotation: rng() * Math.PI * 2,
      scale: 0.45 + rng() * 0.95,
      species: Math.floor(rng() * 4),
    });
  }
  return transforms;
}

function colliderFor(group, mode) {
  if (mode === 'none') return { mode: 'none' };
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  if (mode === 'box')
    return { mode, center: center.toArray(), size: size.toArray() };
  if (mode === 'sphere')
    return { mode, center: center.toArray(), radius: size.length() / 2 };
  const points = [];
  group.traverse((object) => {
    if (!object.isMesh) return;
    const attribute = object.geometry.attributes.position;
    for (let i = 0; i < attribute.count; i++)
      points.push(
        new THREE.Vector3()
          .fromBufferAttribute(attribute, i)
          .applyMatrix4(object.matrixWorld),
      );
  });
  // Unity convex MeshColliders support at most 255 faces. Forty-two support
  // directions produce at most 80 hull faces. Inflate the sampled hull just
  // enough to enclose every source vertex, rather than clipping collision into
  // the rendered rock between samples.
  const samples = sphere(1).points.map((direction) =>
    points.reduce(
      (best, point) =>
        point.dot(direction) > best.dot(direction) ? point : best,
      points[0],
    ),
  );
  const proxy = new ConvexGeometry(samples);
  const pivot = samples
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .divideScalar(samples.length);
  const attribute = proxy.attributes.position;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    normal = new THREE.Vector3();
  let expansion = 1;
  for (let i = 0; i < attribute.count; i += 3) {
    a.fromBufferAttribute(attribute, i);
    b.fromBufferAttribute(attribute, i + 1);
    c.fromBufferAttribute(attribute, i + 2);
    normal.crossVectors(b.sub(a), c.sub(a)).normalize();
    const distance = normal.dot(a.clone().sub(pivot));
    if (distance > 1e-9)
      for (const point of points)
        expansion = Math.max(
          expansion,
          normal.dot(point.clone().sub(pivot)) / distance,
        );
  }
  for (let i = 0; i < attribute.count; i++) {
    a.fromBufferAttribute(attribute, i)
      .sub(pivot)
      .multiplyScalar(expansion * 1.000001)
      .add(pivot);
    attribute.setXYZ(i, a.x, a.y, a.z);
  }
  const vertices = Array.from(proxy.attributes.position.array);
  const indices = Array.from(
    { length: proxy.attributes.position.count },
    (_, i) => i,
  );
  proxy.dispose();
  return { mode: 'convex', vertices, indices };
}

/** Generate three exportable LOD groups. Clones share resources; dispose once. */
export function generateRock(
  input = createRockDefinition(),
  { quality = 'export' } = {},
) {
  if (!['preview', 'export'].includes(quality))
    throw new Error('Rock quality must be preview or export.');
  const definition = createRockDefinition(input.archetype ?? 'rock', input);
  const hash = definitionHash(definition);
  const material = new THREE.MeshStandardMaterial({
    color: definition.weatheringAmount>0?'#ffffff':definition.color,
    roughness: definition.roughness,
    metalness: 0,
    vertexColors: true,
    flatShading: definition.flatShading,
  });
  material.name = `${definition.archetype}-stone`;
  const materialSet = new Set([material]);
  const geometrySet = new Set();
  const transforms =
    definition.archetype === 'cluster'
      ? layoutCluster(definition)
      : [{ x: 0, z: 0, rotation: 0, scale: 1, species: 0 }];
  const details = quality === 'preview' ? [2, 1, 0] : [3, 2, 1];
  const lods = details.map((detail, level) => {
    const group = new THREE.Group();
    group.name = `lod${level}`;
    group.userData = {
      definitionHash: hash,
      archetype: definition.archetype,
      lod: level,
      wind: false,
    };
    const formation=definition.archetype==='outcrop'?formationLayout(definition.seed,random):null;
    const sourceCount = definition.archetype === 'cluster' || formation ? 4 : 1;
    const sources = Array.from({ length: sourceCount }, (_, index) => {
      const species = {
        ...definition,
        seed: (definition.seed + index * 1597334677) >>> 0,
      };
      if (definition.archetype === 'cluster') {
        const recipes = {
          pebbles: {
            sizes: [0.7, 0.9, 1, 1.2],
            forms: ['pebble', 'pebble', 'pebble', 'pebble'],
          },
          mixed: {
            sizes: [0.3, 0.8, 1.25, 2.4],
            forms: ['pebble', 'rock', 'rock', 'boulder'],
          },
          outcrop: {
            sizes: [0.8, 1.6, 2.4, 3.2],
            forms: ['rock', 'rock', 'boulder', 'boulder'],
          },
          scree: {sizes:[.5,.75,1,1.4],forms:['slab','slab','slab','slab']},
        };
        const recipe = recipes[definition.clusterMix];
        species.width *= recipe.sizes[index];
        species.height *= recipe.sizes[index];
        species.depth *= recipe.sizes[index];
        if (recipe.forms[index] === 'pebble') {
          species.roundness = Math.max(0.85, species.roundness);
          species.angularity *= 0.2;
          species.displacement *= 0.6;
        } else if (recipe.forms[index] === 'boulder') {
          species.roundness *= 0.4;
          species.angularity = Math.max(0.7, species.angularity);
        }
        species.archetype = recipe.forms[index];
      }
      const geometry = species.archetype==='slab'||formation
        ? slabGeometry(formation?.[index]||{seed:species.seed,width:species.width,height:species.height,depth:species.depth},level,species.strata??.35,random)
        : rockGeometry(species, detail);
      if(species.archetype==='slab'&&!formation){
        const box=geometry.boundingBox,size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
        geometry.translate(-center.x,-box.min.y,-center.z);geometry.scale(species.width/size.x,species.height/size.y,species.depth/size.z);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
      }
      if(species.archetype==='slab'||formation){
        const positions=geometry.attributes.position,colors=[];
        for(let i=0;i<positions.count;i++){const shade=1-species.variation*(.5+.5*Math.sin(positions.getX(i)*4+species.seed)*Math.cos(positions.getZ(i)*5));colors.push(shade,shade,shade);}
        geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));stoneSurface(geometry,species);
      }
      geometry.userData.archetype = species.archetype;
      geometrySet.add(geometry);
      return geometry;
    });
    (formation?formation.map((_,species)=>({x:0,z:0,rotation:0,scale:1,species})):transforms).forEach((transform, index) => {
      const mesh = new THREE.Mesh(sources[transform.species], material);
      mesh.name = `${definition.archetype}-${index}`;
      mesh.position.set(transform.x, 0, transform.z);
      mesh.rotation.y = transform.rotation;
      mesh.scale.setScalar(transform.scale);
      mesh.castShadow = definition.archetype !== 'pebble';
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.updateMatrixWorld(true);
    if(formation){
      const bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      for(const mesh of group.children){mesh.geometry.translate(-center.x,-bounds.min.y,-center.z);mesh.geometry.scale(definition.width/size.x,definition.height/size.y,definition.depth/size.z);mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
    }
    group.userData.placement = {
      requested: definition.archetype === 'cluster' ? definition.count : 1,
      placed: transforms.length,
      shortfall:
        definition.archetype === 'cluster'
          ? definition.count - transforms.length
          : 0,
    };
    return group;
  });
  const collider = colliderFor(lods[0], definition.colliderMode);
  lods[0].userData.collider = collider;
  let disposed = false;
  return {
    object3D: lods[0],
    lods,
    definition,
    definitionHash: hash,
    collider,
    placement: lods[0].userData.placement,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometrySet) geometry.dispose();
      for (const material of materialSet) material.dispose();
    },
  };
}

const legacyRockPresets = [
  {
    id: 'river-pebble',
    name: 'River Pebble',
    definition: createRockDefinition('pebble'),
  },
  {
    id: 'warm-pebble',
    name: 'Warm Sandstone Pebble',
    definition: createRockDefinition('pebble', {
      seed: 391,
      color: '#a59276',
      width: 0.24,
      height: 0.11,
      depth: 0.19,
    }),
  },
  {
    id: 'field-rock',
    name: 'Field Rock',
    definition: createRockDefinition('rock'),
  },
  {
    id: 'angular-slate',
    name: 'Angular Slate',
    definition: createRockDefinition('rock', {
      seed: 682,
      roundness: 0.05,
      angularity: 1,
      flatShading: true,
      width: 1.4,
      height: 0.45,
      depth: 0.9,
      color: '#667681',
      flattening: 0.8,
    }),
  },
  {
    id: 'granite-boulder',
    name: 'Granite Boulder',
    definition: createRockDefinition('boulder', {
      seed: 98412,
      color: '#8b8883',
      variation: 0.24,
    }),
  },
  {
    id: 'sandstone-boulder',
    name: 'Sandstone Boulder',
    definition: createRockDefinition('boulder', {
      seed: 52111,
      color: '#a9987a',
      roundness: 0.65,
      angularity: 0.38,
      width: 4,
      height: 2.4,
      depth: 2.8,
    }),
  },
  {
    id: 'stone-cluster',
    name: 'Mixed Stone Cluster',
    definition: createRockDefinition('cluster'),
  },
  {
    id: 'pebble-patch',
    name: 'Pebble Patch',
    definition: createRockDefinition('cluster', {
      seed: 7801,
      clusterMix: 'pebbles',
      width: 0.16,
      height: 0.09,
      depth: 0.2,
      count: 48,
      radius: 1.4,
      spacing: 0.12,
      roundness: 0.9,
      angularity: 0.1,
    }),
  },
];

const additions=[
  ['wet-river-stone','Wet River Stone','pebble','General',{seed:8101,width:.32,height:.14,depth:.25,color:'#555f60',roughness:.3,roundness:.98,angularity:.02}],
  ['desert-gravel','Desert Gravel','pebble','Arid',{seed:8102,width:.12,height:.065,depth:.09,color:'#b49c7b',roundness:.2,angularity:.85}],
  ['low-fieldstone','Low Fieldstone','rock','Meadow',{seed:8103,width:1.4,height:.35,depth:1.1,flattening:.85,roundness:.7}],
  ['basalt-chunk','Basalt Chunk','rock','Rocky',{seed:8104,color:'#454a49',roundness:.02,angularity:1,flatShading:true,width:1,height:.85,depth:.8}],
  ['standing-stone','Standing Stone','rock','Rocky',{seed:8105,width:.85,height:2.7,depth:.7,roundness:.03,angularity:1,displacement:.14,flatShading:true}],
  ['limestone-slab','Limestone Slab','slab','Rocky',{seed:8106,color:'#b5b29b',strata:.45}],
  ['red-sandstone-slab','Red Sandstone Slab','slab','Arid',{seed:8107,color:'#ab7355',strata:1,width:2.5,height:.65,depth:1.8}],
  ['glacial-erratic','Glacial Erratic','boulder','Meadow',{seed:8108,width:3.8,height:2.1,depth:3.1,roundness:.85,angularity:.15,color:'#969690',variation:.3}],
  ['volcanic-boulder','Volcanic Boulder','boulder','Rocky',{seed:8109,color:'#514e49',angularity:.95,roundness:.03,displacement:.75,frequency:6,flatShading:true}],
  ['mossy-forest-boulder','Mossy Forest Boulder','boulder','Forest',{seed:8110,width:2.5,height:1.6,depth:2.1,roundness:.7,color:'#858681',weatheringAmount:.9,weatheringColor:'#65763c'}],
  ['talus-scree','Talus Scree','cluster','Rocky',{seed:8111,clusterMix:'scree',count:28,radius:1.35,spacing:.22,width:.45,height:.1,depth:.32,strata:0,flatShading:true,color:'#85877e'}],
  ['river-stone-bed','River Stone Bed','cluster','General',{seed:8112,clusterMix:'pebbles',count:40,radius:1.45,spacing:.22,width:.25,height:.12,depth:.3,roundness:.95,color:'#7e8785'}],
  ['granite-outcrop','Granite Outcrop','outcrop','Rocky',{seed:8113,strata:.1}],
  ['sandstone-outcrop','Sandstone Outcrop','outcrop','Arid',{seed:8114,color:'#bd9b70',strata:1}],
];
const biomeFor={Forest:'forest',Meadow:'meadow',Arid:'desert',Rocky:'rocky'};
export const ROCK_PRESETS=Object.freeze([
  ...legacyRockPresets.map(p=>({...p,group:'General'})),
  ...additions.map(([id,name,archetype,group,overrides])=>({id,name,group,definition:createRockDefinition(archetype,overrides)})),
].map(p=>Object.freeze({...p,layer:p.definition.archetype==='pebble'?'pebbles':['boulder','outcrop'].includes(p.definition.archetype)?'boulders':'rocks',biomes:Object.freeze(biomeFor[p.group]?[biomeFor[p.group]]:[]),definition:Object.freeze(p.definition)})));
