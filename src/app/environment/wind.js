import * as THREE from 'three';
export class WindController {
  constructor(options) {
    this.time = { value: 0 }; this.strength = { value: options.strength };
    this.frequency = { value: options.frequency }; this.direction = { value: new THREE.Vector2(...options.direction) };
    this.spatialScale = { value: options.spatialScale ?? 350 };
    this.materials = new Set();
    this.bindings = new WeakMap();
  }
  attach(material, height = 1, amplitude = 1, weighted = false) {
    if (this.materials.has(material)) return;
    this.materials.add(material);
    const before = material.onBeforeCompile, beforeKey = material.customProgramCacheKey, cacheKey = beforeKey.call(material);
    const onDispose = () => this.detach(material);
    this.bindings.set(material,{before,beforeKey,onDispose});
    material.addEventListener('dispose',onDispose);
    material.customProgramCacheKey = () => `${cacheKey}|ez-wind-4-${weighted}-${height}-${amplitude}`;
    material.onBeforeCompile = (shader,renderer) => {
      before.call(material,shader,renderer);
      Object.assign(shader.uniforms, { ezTime:this.time, ezWind:this.strength, ezFrequency:this.frequency, ezDirection:this.direction, ezSpatialScale:this.spatialScale });
      shader.vertexShader = `uniform float ezTime; uniform float ezWind; uniform float ezFrequency; uniform float ezSpatialScale; uniform vec2 ezDirection; ${weighted ? 'attribute float windWeight;' : ''}\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ezWorld = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          ezWorld = instanceMatrix * ezWorld;
        #endif
        ezWorld = modelMatrix * ezWorld;
        float ezPhase = dot(ezWorld.xz / ezSpatialScale, vec2(63.0,49.0));
        float ezBend = ${weighted ? 'windWeight' : `pow(clamp(position.y / ${Math.max(0.1,height).toFixed(4)},0.0,1.0),2.0)`};
        transformed.xz += ezDirection * ezWind * ezBend * ${amplitude.toFixed(4)} * (sin(ezTime * ezFrequency * 2.0 + ezPhase) + 0.3 * sin(ezTime * 0.7 + ezPhase));`);
    };
    material.needsUpdate = true;
  }
  update(time, options) {
    this.time.value = time;
    if (options) { this.strength.value = options.strength*(1+(options.gustStrength??.2)*Math.sin(time*.7)); this.frequency.value = options.frequency; this.direction.value.fromArray(options.direction);this.spatialScale.value=options.spatialScale??350; }
  }
  detach(material) {
    const binding=this.bindings.get(material);if(!binding)return;
    material.removeEventListener('dispose',binding.onDispose);
    material.onBeforeCompile=binding.before;material.customProgramCacheKey=binding.beforeKey;
    this.bindings.delete(material);this.materials.delete(material);
  }
  dispose() { for(const material of this.materials)this.detach(material); }
}

// Tree shaders displace view-space positions. Transform the shared world-space
// wind once into their coordinate system; no traversal or core library changes.
const treeDirection = new THREE.Vector3();
export function updateTreeWind(tree, wind, camera, time) {
  tree.update(time);
  const uniforms=tree.leavesMesh.material.userData.shader?.uniforms;
  if(!uniforms?.uWindStrength)return;
  treeDirection.set(wind.direction.value.x,0,wind.direction.value.y);
  const magnitude=treeDirection.length()*wind.strength.value;
  if(magnitude===0)treeDirection.set(0,0,0);else treeDirection.transformDirection(camera.matrixWorldInverse).multiplyScalar(magnitude);
  uniforms.uWindStrength.value.copy(treeDirection);
  uniforms.uWindFrequency.value=wind.frequency.value*2;
  uniforms.uWindScale.value=wind.spatialScale.value;
}
