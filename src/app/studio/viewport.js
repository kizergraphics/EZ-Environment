const MODES = ['tree', 'plant', 'rock', 'environment'];

export function validateLastAuthoredMode(value, mode) {
  if (value !== undefined && value !== null && !['tree', 'plant', 'rock'].includes(value)) throw new Error('Unknown saved preview asset.');
  return mode && mode !== 'environment' ? mode : value ?? null;
}

export function validateCameraState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid saved camera.');
  for (const key of ['position', 'target']) {
    if (!Array.isArray(state[key]) || state[key].length !== 3 || !state[key].every(n => Number.isFinite(n) && Math.abs(n) <= 100000)) throw new Error(`Invalid camera ${key}.`);
  }
  const { near = .01, far = 2000, zoom = 1 } = state;
  if (![near, far, zoom].every(Number.isFinite) || near < .001 || near > 1000 || far <= near || far > 1000000 || zoom < .01 || zoom > 100) throw new Error('Invalid saved camera projection.');
  if (state.position.every((n, i) => Math.abs(n - state.target[i]) < .00001)) throw new Error('Camera position must differ from its target.');
  return { position: [...state.position], target: [...state.target], near, far, zoom };
}

export function validateCameras(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid workspace cameras.');
  const modes = {};
  if (input.modes !== undefined && (!input.modes || typeof input.modes !== 'object' || Array.isArray(input.modes))) throw new Error('Invalid mode cameras.');
  for (const [mode, state] of Object.entries(input.modes || {})) {
    if (!MODES.includes(mode)) throw new Error('Unknown saved camera mode.');
    modes[mode] = validateCameraState(state);
  }
  const bookmarks = input.bookmarks ?? [null, null, null];
  if (!Array.isArray(bookmarks) || bookmarks.length !== 3) throw new Error('A workspace has three camera bookmarks.');
  return { modes, bookmarks: bookmarks.map(entry => {
    if (entry === null) return null;
    if (!entry || !MODES.includes(entry.mode)) throw new Error('Invalid bookmark mode.');
    return { mode: entry.mode, camera: validateCameraState(entry.camera) };
  }) };
}

// A fixed, bounded search makes the preset reproducible while avoiding a camera
// inside a nearby outcrop. Prefer the original framing whenever it has room.
export function chooseGroundPosition(radius, obstacles) {
  const initial={x:radius*.22,z:radius*.32},angle=Math.atan2(initial.z,initial.x);
  const clearance=point=>{
    let result=Infinity;
    for(const obstacle of obstacles){
      result=Math.min(result,Math.hypot(point.x-obstacle.x,point.z-obstacle.z)-obstacle.radius);
      // Also leave a short corridor toward the subject for the near view.
      const distance=Math.hypot(point.x,point.z),factor=Math.max(0,1-Math.min(5,distance*.15)/distance);
      result=Math.min(result,Math.hypot(point.x*factor-obstacle.x,point.z*factor-obstacle.z)-obstacle.radius);
    }
    return result;
  };
  let best={...initial,clearance:clearance(initial)};
  if(best.clearance>=1.5)return best;
  for(const ratio of [.35,.27,.44,.55])for(let step=0;step<24;step++){
    const a=angle+step*Math.PI/12,point={x:Math.cos(a)*radius*ratio,z:Math.sin(a)*radius*ratio},room=clearance(point);
    if(room>best.clearance)best={...point,clearance:room};
    if(room>=1.5)return best;
  }
  return best;
}
