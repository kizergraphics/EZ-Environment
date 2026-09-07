import * as THREE from 'three';

export const LOD_TRANSITIONS = Object.freeze({ near: 48, far: 100, width: 5 });

/** Bit mask of groups to draw. Both neighbors participate only inside a fade. */
export function lodVisibilityMask(distance) {
  if (distance <= 43) return 1;
  if (distance < 53) return 3;
  if (distance <= 95) return 2;
  if (distance < 105) return 6;
  return 4;
}

/** Shared across chunks; a source material owns at most one variant per LOD. */
export class LodController {
  constructor(chunkSize = 48) {
    this.uniforms = {
      ezViewerPosition: { value: new THREE.Vector3() },
      ezChunkSize: { value: chunkSize },
      ezPreviewRadius: { value: 0 },
    };
    this.sources = new Map();
  }

  patch(material, level) {
    const before = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `uniform vec3 ezViewerPosition; uniform float ezChunkSize; uniform float ezPreviewRadius; varying float vEzPreviewHidden; varying float vEzLodDistance;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ezLodOrigin = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          ezLodOrigin = instanceMatrix * ezLodOrigin;
        #endif
        ezLodOrigin = modelMatrix * ezLodOrigin;
        vEzPreviewHidden = ezPreviewRadius > 0.0 && length(ezLodOrigin.xz) < ezPreviewRadius ? 1.0 : 0.0;
        vec2 ezLodCenter = (floor(ezLodOrigin.xz / ezChunkSize) + vec2(0.5)) * ezChunkSize;
        vEzLodDistance = distance(ezViewerPosition, vec3(ezLodCenter.x, 0.0, ezLodCenter.y));`);
      shader.fragmentShader = `varying float vEzPreviewHidden; varying float vEzLodDistance;\n${shader.fragmentShader}`;
      const rejection = level === 0 ? 'ezScreen < ezNearFade' : level === 1 ? 'ezScreen >= ezNearFade || ezScreen < ezFarFade' : 'ezScreen >= ezFarFade';
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (vEzPreviewHidden > 0.5) discard;
        float ezScreen = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
        float ezNearFade = smoothstep(43.0, 53.0, vEzLodDistance);
        float ezFarFade = smoothstep(95.0, 105.0, vEzLodDistance);
        if (${rejection}) discard;`);
    };
    material.customProgramCacheKey = () => `${cacheKey}|ez-dither-v2-lod${level}`;
    material.userData.ezLod = level;
    material.needsUpdate = true;
  }

  bind(source, level, wind = null, windSpec = null, shadows = false) {
    let entry = this.sources.get(source);
    if (!entry) {
      entry = { levels: new Map(), onDispose: () => this.detach(source) };
      this.sources.set(source, entry);
      source.addEventListener('dispose', entry.onDispose);
    }
    let binding = entry.levels.get(level);
    if (!binding) {
      const material = source.clone();
      material.name = `${source.name || source.type} LOD ${level}`;
      // Material.clone deliberately does not copy onBeforeCompile. Preserve the
      // source's existing wind/custom behavior before composing the fade shader.
      material.onBeforeCompile = source.onBeforeCompile;
      const key = source.customProgramCacheKey();
      material.customProgramCacheKey = () => key;
      this.patch(material, level);
      binding = { material, depth: null };
      entry.levels.set(level, binding);
    }
    if (shadows && !binding.depth) {
      const depth = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: source.map || null,
        alphaMap: source.alphaMap || null,
        alphaTest: source.alphaTest,
        side: source.side,
        displacementMap: source.displacementMap || null,
        displacementScale: source.displacementScale,
        displacementBias: source.displacementBias,
      });
      depth.name = `${source.name || source.type} LOD ${level} shadow`;
      if (wind && windSpec) wind.attach(depth, windSpec.height, windSpec.amplitude, windSpec.weighted);
      this.patch(depth, level);
      binding.depth = depth;
    }
    return binding;
  }

  update(camera, chunkSize) {
    if (camera) this.uniforms.ezViewerPosition.value.copy(camera.position);
    else this.uniforms.ezViewerPosition.value.set(0, 0, 0);
    this.uniforms.ezChunkSize.value = chunkSize;
  }

  detach(source) {
    const entry = this.sources.get(source);
    if (!entry) return;
    source.removeEventListener('dispose', entry.onDispose);
    this.sources.delete(source);
    for (const binding of entry.levels.values()) {
      binding.material.dispose();
      binding.depth?.dispose();
    }
    entry.levels.clear();
  }

  dispose() {
    for (const source of this.sources.keys()) this.detach(source);
  }
}
