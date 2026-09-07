export function hash(value) {
  const text = typeof value === 'string' ? value : canonical(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function random(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : parseInt(hash(seed), 16);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export function noise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const smooth = t => t * t * (3 - 2 * t);
  const at = (a, b) => parseInt(hash(`${seed}:${a}:${b}`), 16) / 4294967295;
  return lerp(lerp(at(ix, iz), at(ix + 1, iz), smooth(fx)), lerp(at(ix, iz + 1), at(ix + 1, iz + 1), smooth(fx)), smooth(fz));
}

// Avalanche integer coordinates before interpolation. The original FNV field is
// retained above for legacy projects, whose neighboring hashes can form bands.
export function biomeNoise(x,z,seed=0){
  const ix=Math.floor(x),iz=Math.floor(z),smooth=t=>t*t*t*(t*(t*6-15)+10);
  const at=(a,b)=>{let h=Math.imul(a,0x1f123bb5)^Math.imul(b,0x5f356495)^seed;h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return ((h^(h>>>16))>>>0)/4294967295;};
  const fx=smooth(x-ix),fz=smooth(z-iz);return lerp(lerp(at(ix,iz),at(ix+1,iz),fx),lerp(at(ix,iz+1),at(ix+1,iz+1),fx),fz);
}
