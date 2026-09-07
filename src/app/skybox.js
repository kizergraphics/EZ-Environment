import * as THREE from 'three';
import { degToRad } from 'three/src/math/MathUtils.js';
import fragmentShader from './shaders/skybox.frag?raw';
import vertexShader from './shaders/skybox.vert?raw';

export class SkyboxOptions {
  constructor() {
    /**
     * Azimuth of the sun in degrees
     */
    this.sunAzimuth = 125;

    /**
     * Elevation of the sun in degrees
     */
    this.sunElevation = 35;

    /**
     * Color of the sun
     */
    this.sunColor = new THREE.Color(0xfff1d7);

    /**
     * Size of the sun in the sky
     */
    this.sunSize = 1;

    /**
     * Color of the sky in the lower part of the sky
     */
    this.skyColorLow = new THREE.Color(0xc5d6ca);

    /**
     * Color of the sun in the higher part of the sky
     */
    this.skyColorHigh = new THREE.Color(0x79a8c3);
  }
}

/**
 * Configurable skybox with sun and built-in lighting
 */
export class Skybox extends THREE.Mesh {
  /**
   * 
   * @param {SkyboxOptions} options 
   */
  constructor(options = new SkyboxOptions()) {
    super();

    this.name = 'Skybox';

    // Create a box geometry and apply the skybox material
    this.geometry = new THREE.SphereGeometry(900, 32, 16);

    // Create the skybox material with the shaders
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uSunAzimuth: { value: options.sunAzimuth },
        uSunElevation: { value: options.sunElevation },
        uSunColor: { value: options.sunColor },
        uSkyColorLow: { value: options.skyColorLow },
        uSkyColorHigh: { value: options.skyColorHigh },
        uSunSize: { value: options.sunSize }
      },
      side: THREE.BackSide,
      depthWrite: false,
      // Three r167 applies fog after tone mapping. Match its unlit horizon
      // color directly; the Photorealistic OutputPass maps sky and fog together.
      toneMapped: false,
    });

    this.renderOrder = -1000;
    this.frustumCulled = false;
    this.sunDistance = 260;

    this.sun = new THREE.DirectionalLight();
    this.sun.intensity = 3;
    this.sun.color.copy(options.sunColor);
    this.sun.position.set(50, 100, 50);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -100;
    this.sun.shadow.camera.right = 100;
    this.sun.shadow.camera.top = 100;
    this.sun.shadow.camera.bottom = -100;
    this.sun.shadow.camera.near = .1;
    this.sun.shadow.camera.far = 650;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -.00012;
    this.sun.shadow.normalBias = .055;
    this.sun.shadow.radius = 2;
    this.add(this.sun, this.sun.target);

    this.ambient = new THREE.HemisphereLight(options.skyColorLow, 0x5d5948, 1.6);
    this.add(this.ambient);

    this.updateSunPosition();
  }

  updateSunPosition() {
    const el = degToRad(this.sunElevation);
    const az = degToRad(this.sunAzimuth);

    this.sun.position.set(
      this.sunDistance * Math.cos(el) * Math.sin(az),
      this.sunDistance * Math.sin(el),
      this.sunDistance * Math.cos(el) * Math.cos(az)
    );
  }

  configure(lighting, quality = 'medium', radius = 96) {
    this.sunElevation = lighting.elevation;
    this.sunColor = new THREE.Color(lighting.sun);
    this.skyColorLow = new THREE.Color(lighting.horizon);
    this.skyColorHigh = new THREE.Color(lighting.sky);
    this.sun.intensity = lighting.intensity;
    this.ambient.color.set(lighting.horizon);
    this.ambient.groundColor.set(lighting.fog).multiplyScalar(.38);
    this.ambient.intensity = lighting.ambient;
    this.sun.castShadow = quality !== 'low';
    const resolution = quality === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== resolution) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(resolution, resolution);
    }
    // Project a world-radius sphere plus canopy height into the actual sun
    // camera. Low-angle sunlight needs room for crowns above the ground.
    const extent = Math.max(32, Math.min(295, radius + 20));
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = shadowCamera.bottom = -extent;
    shadowCamera.right = shadowCamera.top = extent;
    this.sunDistance = Math.max(160, extent * 2.5);
    shadowCamera.near = .1;
    shadowCamera.far = this.sunDistance * 2.4;
    shadowCamera.updateProjectionMatrix();
    this.updateSunPosition();
    this.sun.shadow.needsUpdate = true;
  }

  /**
   * @returns {number}
   */
  get sunAzimuth() {
    return this.material.uniforms.uSunAzimuth.value;
  }

  set sunAzimuth(azimuth) {
    this.material.uniforms.uSunAzimuth.value = azimuth;
    this.updateSunPosition();
  }

  /**
   * @returns {number}
   */
  get sunElevation() {
    return this.material.uniforms.uSunElevation.value;
  }

  set sunElevation(elevation) {
    this.material.uniforms.uSunElevation.value = elevation;
    this.updateSunPosition();
  }

  /**
   * @returns {THREE.Color}
   */
  get sunColor() {
    return this.material.uniforms.uSunColor.value;
  }

  set sunColor(color) {
    this.material.uniforms.uSunColor.value = color;
    this.sun.color = color;
  }

  /**
   * @returns {THREE.Color}
   */
  get skyColorLow() {
    return this.material.uniforms.uSkyColorLow.value;
  }

  set skyColorLow(color) {
    this.material.uniforms.uSkyColorLow.value = color;
  }

  /**
    * @returns {THREE.Color}
    */
  get skyColorHigh() {
    return this.material.uniforms.uSkyColorHigh.value;
  }

  set skyColorHigh(color) {
    this.material.uniforms.uSkyColorHigh.value = color;
  }

  /**
   * @returns {number}
   */
  get sunSize() {
    return this.material.uniforms.uSunSize.value;
  }

  set sunSize(size) {
    this.material.uniforms.uSunSize.value = size;
  }
}
