import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { downloadBlob, exportPNG } from './export/exporters.js';

/** Reconstruct normals from the actual color-pass depth: foliage alpha and wind
 * stay intact, and AO does not require another render of the environment. */
class ContactAOPass extends GTAOPass {
  constructor(scene, camera) {
    super(scene, camera, 1, 1);
    this.resolutionScale = .5;
    this.blendIntensity = .48;
    this.updateGtaoMaterial({ radius: 1.25, thickness: .7, distanceFallOff: 1, scale: 1, samples: 8, screenSpaceRadius: false });
    this.updatePdMaterial({ samples: 8, radius: 5, rings: 2, lumaPhi: 8, depthPhi: 3, normalPhi: 4 });
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.depthTexture !== readBuffer.depthTexture) {
      this.setGBuffer(readBuffer.depthTexture, undefined);
      // The first render switches from MeshNormalMaterial to depth reconstruction.
      if (!this.depthConfigured) {
        this.gtaoMaterial.needsUpdate = this.pdMaterial.needsUpdate = true;
        this.depthConfigured = true;
      }
    }
    super.render(renderer, writeBuffer, readBuffer);
  }

  setSize(width, height) {
    super.setSize(Math.max(1, Math.round(width * (this.resolutionScale ?? .5))), Math.max(1, Math.round(height * (this.resolutionScale ?? .5))));
  }

  dispose() {
    // The r167 pass omits this material in its own disposal method.
    this.blendMaterial.dispose();
    super.dispose();
  }
}

export function createRenderPipeline({ renderer, scene, camera, environment, container, getMode }) {
  let composer = null, ao = null, output = null, capturing = false;
  let activeAppearance = 'naturalistic', quality = 'medium';
  const viewport = new THREE.Vector2(), lastDraw = { calls: 0, triangles: 0 };
  const fog = new THREE.FogExp2(0xc5d6ca, .0022);

  function createComposer() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType),
      samples: quality === 'high' ? 4 : 2,
    });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(scene, camera));
    ao = new ContactAOPass(scene, camera);
    composer.addPass(ao);
    output = new OutputPass();
    composer.addPass(output);
    setComposerQuality();
  }

  function setComposerQuality() {
    if (!composer) return;
    ao.enabled = quality !== 'low';
    ao.resolutionScale = quality === 'high' ? 1 : .5;
    ao.blendIntensity = quality === 'high' ? .55 : .48;
    ao.updateGtaoMaterial({ samples: quality === 'high' ? 12 : 8 });
    const samples = quality === 'high' ? 4 : 2;
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      if (target.samples !== samples) { target.dispose(); target.samples = samples; }
    }
    const size = renderer.getDrawingBufferSize(viewport);
    composer.setSize(size.x, size.y);
  }

  function syncSceneAppearance() {
    const mode = getMode?.() ?? 'environment', options = environment.options;
    quality = options.quality;
    activeAppearance = options.appearance ?? 'naturalistic';
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = options.lighting.exposure;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    environment.skybox.configure(options.lighting, quality, mode === 'tree' ? 55 : options.radius);
    fog.color.set(options.lighting.fog);
    fog.density = options.lighting.fogDensity;
    scene.fog = fog;
    scene.background = null;
    if (activeAppearance === 'photorealistic' && !composer) createComposer();
    setComposerQuality();
    resize();
  }

  function resize() {
    if (capturing) return;
    const width = Math.max(1, Math.floor(container.clientWidth)), height = Math.max(1, Math.floor(container.clientHeight));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, quality === 'low' ? 1 : quality === 'high' ? 2 : 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(Math.round(width * dpr), Math.round(height * dpr));
  }

  function render() {
    // CLI/browser integrations can update the controller without going through
    // Studio's inspector. Keep both render paths aligned with those settings.
    if (quality !== environment.options.quality || activeAppearance !== (environment.options.appearance ?? 'naturalistic')) syncSceneAppearance();
    const autoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    try {
      if (activeAppearance === 'photorealistic' && composer) composer.render();
      else renderer.render(scene, camera);
      lastDraw.calls = renderer.info.render.calls;
      lastDraw.triangles = renderer.info.render.triangles;
    } finally {
      renderer.info.autoReset = autoReset;
    }
  }

  async function capturePNG(size = 'viewport', { download = true } = {}) {
    if (capturing) throw new Error('A PNG capture is already in progress.');
    if (!['viewport', '1080', '1080p', '4k'].includes(size)) throw new Error('Choose viewport, 1080p, or 4K capture.');
    const native = renderer.getDrawingBufferSize(new THREE.Vector2());
    const dimensions = size === 'viewport' ? [native.x, native.y] : size === '4k' ? [3840, 2160] : [1920, 1080];
    const saved = {
      size: renderer.getSize(new THREE.Vector2()), dpr: renderer.getPixelRatio(),
      target: renderer.getRenderTarget(), viewport: renderer.getViewport(new THREE.Vector4()),
      scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(),
      aspect: camera.aspect, projection: camera.projectionMatrix.clone(), inverseProjection: camera.projectionMatrixInverse.clone(),
    };
    const helpers = [];
    scene.traverse(object => { if (object.userData.editorOnly && object.visible) { helpers.push(object); object.visible = false; } });
    capturing = true;
    let png;
    try {
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setPixelRatio(1);
      renderer.setSize(dimensions[0], dimensions[1], false);
      camera.aspect = dimensions[0] / dimensions[1];
      camera.updateProjectionMatrix();
      composer?.setSize(dimensions[0], dimensions[1]);
      render();
      // toBlob snapshots now; restore the live workspace before PNG encoding
      // finishes or another animation frame can see the temporary camera.
      png = exportPNG(renderer, 'preview.png', { download: false });
    } finally {
      helpers.forEach(object => { object.visible = true; });
      renderer.setPixelRatio(saved.dpr);
      renderer.setSize(saved.size.x, saved.size.y, false);
      composer?.setSize(Math.round(saved.size.x * saved.dpr), Math.round(saved.size.y * saved.dpr));
      camera.aspect = saved.aspect;
      camera.projectionMatrix.copy(saved.projection);
      camera.projectionMatrixInverse.copy(saved.inverseProjection);
      renderer.setRenderTarget(saved.target);
      renderer.setViewport(saved.viewport);
      renderer.setScissor(saved.scissor);
      renderer.setScissorTest(saved.scissorTest);
      capturing = false;
      render();
    }
    const blob = await png;
    if (download) downloadBlob(blob, `${getMode?.() ?? 'environment'}-${environment.options.biome}-${activeAppearance}-${size}.png`);
    return blob;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener('resize', resize);
  return {
    render, resize, syncSceneAppearance, capturePNG, lastDraw,
    get settings() { return { appearance: activeAppearance, quality, contactAO: activeAppearance === 'photorealistic' && quality !== 'low', aoResolutionScale: ao?.resolutionScale ?? 0 }; },
    dispose() {
      observer.disconnect(); window.removeEventListener('resize', resize);
      ao?.dispose(); output?.dispose(); composer?.dispose();
    },
  };
}
