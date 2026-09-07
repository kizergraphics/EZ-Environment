import { random, hash, noise,biomeNoise } from './random.js';
import { validateOptions, LAYERS } from './options.js';

export function contains(shape, x, z, buffer = 0) {
  if (shape.type === 'circle') return Math.hypot(x - shape.x, z - shape.z) <= shape.radius + buffer;
  if (shape.type === 'rectangle') return Math.abs(x - shape.x) <= shape.width / 2 + buffer && Math.abs(z - shape.z) <= shape.depth / 2 + buffer;
  if (shape.type === 'path') {
    return shape.points.slice(1).some((b, i) => {
      const a = shape.points[i], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) <= shape.width / 2 + buffer;
    });
  }
  let inside = false;
  for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
    const a = shape.points[i], b = shape.points[j];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) <= buffer + 1e-10) return true;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function terrainHeight(x, z, o) {
  if (!o.terrain.amplitude) return 0;
  const s = o.terrain.scale;
  const t = Math.max(0,Math.min(1,(Math.hypot(x,z)-o.radius)/(o.radius*.2)));
  if(t===1)return 0;
  const falloff = 1-t*t*(3-2*t);
  if(o.composition==='biome'){
    const broad=(biomeNoise(x/s,z/s,o.seed)*.75+biomeNoise(x/(s*.6),z/(s*.6),o.seed^71)*.25-.5)*2;
    const fine=(biomeNoise(x/(s*.35),z/(s*.35),o.seed^1987)-.5)*.32;
    if(o.terrain.form==='dunes')return falloff*o.terrain.amplitude*(Math.sin((x*.85+z*.3)/s*3+Math.sin(z/s)*1.5)*.6+broad*.4+fine*.1);
    if(o.terrain.form==='ridges')return falloff*o.terrain.amplitude*(1-Math.abs(broad)*2+fine);
    return falloff*o.terrain.amplitude*(broad+fine);
  }
  return falloff * o.terrain.amplitude * (Math.sin(x / s) * Math.cos(z / s) + 0.3 * Math.sin((x + z) / (s * 0.5)));
}
export function terrainNormal(x, z, o) {
  const d = 0.1, dx = (terrainHeight(x + d, z, o) - terrainHeight(x - d, z, o)) / (2 * d), dz = (terrainHeight(x, z + d, o) - terrainHeight(x, z - d, o)) / (2 * d);
  const len = Math.hypot(dx, 1, dz); return [-dx / len, 1 / len, -dz / len];
}
export function chunkKeys(o) {
  const keys = [], n = Math.ceil(o.radius / o.chunkSize);
  for (let x = -n; x < n; x++) for (let z = -n; z < n; z++) {
    if (Math.hypot((Math.abs(x + 0.5) - 0.5) * o.chunkSize, (Math.abs(z + 0.5) - 0.5) * o.chunkSize) < o.radius) keys.push([x, z]);
  }
  return keys;
}

/** Bounded, bilinear grayscale mask in world X/Z coordinates; outside is empty. */
export function sampleDensityMap(map,x,z) {
  if(!map)return 1;
  const u=(x-map.origin[0])/map.size[0],v=(z-map.origin[1])/map.size[1];
  if(u<0||u>1||v<0||v>1)return 0;
  const px=u*(map.width-1),pz=v*(map.height-1),x0=Math.floor(px),z0=Math.floor(pz),x1=Math.min(map.width-1,x0+1),z1=Math.min(map.height-1,z0+1),tx=px-x0,tz=pz-z0;
  const a=map.data[z0*map.width+x0]*(1-tx)+map.data[z0*map.width+x1]*tx;
  const b=map.data[z1*map.width+x0]*(1-tx)+map.data[z1*map.width+x1]*tx;
  return a*(1-tz)+b*tz;
}
export function sampleMoisture(x,z,o) {return (o.composition==='biome'?biomeNoise:noise)(x/48,z/48,o.seed^0x48d7341b);}
export function sampleCanopy(x,z,o) {
  let open=1;
  for(const source of o.canopySources){
    const distance=Math.hypot(x-source.x,z-source.z);
    if(distance<source.radius){const falloff=1-distance/source.radius;open*=1-source.strength*falloff*falloff;}
  }
  return 1-open;
}
function weightedArea(o,cx,cz,opts,baseArea){
  if(!opts.densityMap&&!opts.canopyReduction)return baseArea;
  let coverage=0;
  for(let a=0;a<8;a++)for(let b=0;b<8;b++){
    const x=(cx+(a+.5)/8)*o.chunkSize,z=(cz+(b+.5)/8)*o.chunkSize;
    if(Math.hypot(x,z)<o.radius)coverage+=sampleDensityMap(opts.densityMap,x,z)*(1-sampleCanopy(x,z,o)*opts.canopyReduction);
  }
  return o.chunkSize*o.chunkSize*coverage/64;
}
function pickSpecies(opts,roll){
  if(!opts.speciesChoices.length)return opts.species;
  let total=0;for(const choice of opts.speciesChoices)total+=choice.weight;
  const target=roll*total;let value=0;
  for(const choice of opts.speciesChoices){value+=choice.weight;if(target<value)return choice.id;}
  return opts.speciesChoices[opts.speciesChoices.length-1].id;
}

// Sampling is independent of render quality and chunk traversal. Every world cell
// has one seeded candidate; priority suppression guarantees spacing even across
// chunk edges. Rejected or painted-out candidates still reserve their local space,
// so changing a mask cannot invalidate a previously untouched neighboring chunk.
export const MAX_PLACEMENTS_PER_LAYER = 100000;
export const MAX_PLACEMENTS_PER_CHUNK = 10000;
const samplingCache = new WeakMap();
function samplingArea(o, cx, cz) {
  let fraction = 0;
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
    if (Math.hypot((cx + (a + .5) / 8) * o.chunkSize, (cz + (b + .5) / 8) * o.chunkSize) < o.radius) fraction++;
  }
  return o.chunkSize * o.chunkSize * fraction / 64;
}
function sampling(o) {
  let info = samplingCache.get(o);
  if (!info) {
    const area = new Map(chunkKeys(o).map(([x, z]) => [`${x}:${z}`, samplingArea(o, x, z)]));
    info = { area, total: [...area.values()].reduce((sum, n) => sum + n, 0) };
    samplingCache.set(o, info);
  }
  return info;
}
export function generateChunk(o, cx, cz, layer, footprints = []) {
  const opts = o.layers[layer], size = o.chunkSize;
  if (!opts.enabled || opts.density === 0) return { records: [], shortfall: 0, attempts: 0 };
  const area = sampling(o), effectiveDensity = Math.min(opts.density, MAX_PLACEMENTS_PER_LAYER / Math.max(1, area.total));
  const wanted = Math.min(MAX_PLACEMENTS_PER_CHUNK, Math.floor(weightedArea(o,cx,cz,opts,area.area.get(`${cx}:${cz}`)||0) * effectiveDensity));
  if (!wanted) return { records: [], shortfall: 0, attempts: 0 };
  const pitch = Math.max(opts.minSpacing / Math.SQRT2, 1 / Math.sqrt(effectiveDensity * 2.5));
  const neighborRadius = Math.ceil(opts.minSpacing / pitch);
  const cells = new Map(), candidates = [], minX = cx * size, minZ = cz * size;
  const candidate = (gx, gz) => {
    const key = `${gx}:${gz}`;
    if (!cells.has(key)) {
      const rng = random(`${o.seed}:${layer}:cell:${gx}:${gz}`);
      cells.set(key, { x: (gx + rng()) * pitch, z: (gz + rng()) * pitch, priority: rng(), roll: rng(), gx, gz });
    }
    return cells.get(key);
  };
  let attempts = 0;
  const attemptLimit = wanted * 18 + 32;
  scan: for (let gx = Math.floor(minX / pitch); gx <= Math.floor((minX + size) / pitch); gx++) for (let gz = Math.floor(minZ / pitch); gz <= Math.floor((minZ + size) / pitch); gz++) {
    if (attempts >= attemptLimit) break scan;
    attempts++;
    const point = candidate(gx, gz), { x, z, roll } = point;
    if (x < minX || x >= minX + size || z < minZ || z >= minZ + size) continue;
    if (x * x + z * z > o.radius * o.radius || o.exclusions.some(e => contains(e, x, z)) || o.treeExclusions.some(e=>contains(e,x,z))) continue;
    const fieldNoise=o.composition==='biome'?biomeNoise:noise;
    let density = 1 - opts.patchiness * (0.6 * fieldNoise(x / 14, z / 14, o.seed) + 0.4 * fieldNoise(x / 5, z / 5, o.seed + 1));
    for (const b of o.brushes) if ((!b.layer || b.layer === layer) && contains(b, x, z)) density += b.strength;
    if(opts.densityMap)density*=sampleDensityMap(opts.densityMap,x,z);
    let canopy=0;
    if(opts.canopyReduction||opts.rules.minCanopy>0||opts.rules.maxCanopy<1)canopy=sampleCanopy(x,z,o);
    if(opts.canopyReduction)density*=1-canopy*opts.canopyReduction;
    if (roll > Math.max(0, Math.min(1, density))) continue;
    if (['grass', 'flowers', 'plants'].includes(layer) && footprints.some(f => Math.abs(x - f.x) < f.radius && Math.abs(z - f.z) < f.radius && contains(f, x, z))) continue;
    const normal = terrainNormal(x, z, o);
    const rules=opts.rules;
    if (normal[1] < Math.cos(rules.maxSlope * Math.PI / 180) || normal[1]>Math.cos(rules.minSlope*Math.PI/180)) continue;
    const elevation=terrainHeight(x,z,o);
    if(elevation<rules.minElevation||elevation>rules.maxElevation||canopy<rules.minCanopy||canopy>rules.maxCanopy)continue;
    if(rules.minMoisture>0||rules.maxMoisture<1){const moisture=sampleMoisture(x,z,o);if(moisture<rules.minMoisture||moisture>rules.maxMoisture)continue;}
    let tooClose = false;
    neighbors: for (let a = -neighborRadius; a <= neighborRadius; a++) for (let b = -neighborRadius; b <= neighborRadius; b++) {
      if (!a && !b) continue;
      const other = candidate(gx + a, gz + b);
      const earlier = other.priority < point.priority || other.priority === point.priority && (other.gx < gx || other.gx === gx && other.gz < gz);
      if (earlier && Math.hypot(x - other.x, z - other.z) < opts.minSpacing) { tooClose = true; break neighbors; }
    }
    if (tooClose) continue;
    candidates.push({ ...point, normal,elevation });
  }
  // Keep a uniformly distributed, stable subset when oversampling fills the budget.
  candidates.sort((a, b) => a.priority - b.priority || a.gx - b.gx || a.gz - b.gz);
  const records = candidates.slice(0, wanted).map(({x, z, normal, elevation,gx, gz}) => {
    const rng = random(`${o.seed}:${layer}:instance:${gx}:${gz}`);
    const scale = opts.size * (0.65 + rng() * 0.7), yaw = rng() * Math.PI * 2;
    const stone=['rocks', 'boulders', 'pebbles'].includes(layer);
    const burial = stone ? scale * opts.height * (opts.burialDepth + rng() * opts.burialVariation) : 0;
    if(stone&&normal[1]<Math.cos(opts.maxTilt*Math.PI/180)){
      const horizontal=Math.hypot(normal[0],normal[2]),angle=opts.maxTilt*Math.PI/180;
      normal[0]=horizontal?normal[0]/horizontal*Math.sin(angle):0;normal[1]=Math.cos(angle);normal[2]=horizontal?normal[2]/horizontal*Math.sin(angle):0;
    }
    const species=opts.speciesChoices.length?pickSpecies(opts,random(`${o.seed}:${layer}:species:${gx}:${gz}`)()):opts.species;
    return { species, position: [x, elevation - burial, z], yaw, normal, scale: [scale*opts.width, scale*opts.height, scale*opts.width], tint: (0.85 + rng() * 0.25)*opts.tint, variationSeed: Math.floor(rng() * 4294967295) };
  });
  return { records, shortfall: Math.max(0, wanted - records.length), attempts };
}
export function generatePlacement(input, previous = null, dirty = null) {
  const o = validateOptions(input), chunks = new Map(), keys = chunkKeys(o), footprints = [];
  for (const [x,z] of keys) chunks.set(`${x}:${z}`, { x,z,layers:{} });
  for (const layer of ['boulders', 'rocks', 'pebbles', 'plants', 'flowers', 'grass']) {
    for (const chunk of chunks.values()) {
      const key = `${chunk.x}:${chunk.z}`;
      const old = previous?.chunks?.get(key)?.layers?.[layer];
      const result = old && dirty && !dirty.has(key) ? old : generateChunk(o, chunk.x, chunk.z, layer, footprints);
      chunk.layers[layer] = result;
      if (layer === 'boulders' || layer === 'rocks') for (const r of result.records) footprints.push({ type:'circle', x:r.position[0],z:r.position[2],radius:r.scale[0] * (layer === 'boulders' ? 2.1 : 0.85) });
    }
  }
  const count = Object.fromEntries(LAYERS.map(l => [l, [...chunks.values()].reduce((sum,c) => sum + c.layers[l].records.length, 0)]));
  return { options:o, chunks, count, hash:hash([...chunks.values()]) };
}
