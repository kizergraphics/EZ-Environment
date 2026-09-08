import * as THREE from 'three';

/**
 * Trellis structure for guiding tree branch growth
 * Creates a grid of cylinders that branches can be attracted to
 */
export class Trellis extends THREE.Group {
  /**
   * @param {Object} options Trellis configuration
   */
  constructor(options) {
    super();
    this.name = 'Trellis';
    this.options = options;
    this.material = null;
    this.hCylinderGeo = null;
    this.vCylinderGeo = null;
    this.endGeometry = null;
    this.endMaterial = null;
  }

  /**
   * Generate the trellis geometry
   */
  generate() {
    const t = this.options;

    // Clear existing geometry
    this.dispose();

    this.material = new THREE.MeshStandardMaterial({
      name: 'Trellis wood',
      color: t.color,
      roughness: 0.8,
      map: t.maps?.map ?? null,
      normalMap: t.maps?.normalMap ?? null,
      roughnessMap: t.maps?.roughnessMap ?? null,
    });
    this.material.userData.pbrFamily = 'wood';
    this.material.userData.pbrReady = !!t.maps;
    this.material.normalScale.setScalar(.55);
    if (t.endMaps) {
      this.endMaterial = new THREE.MeshStandardMaterial({
        name: 'Trellis cut ends', color: t.color, roughness: .85,
        map: t.endMaps.map, normalMap: t.endMaps.normalMap, roughnessMap: t.endMaps.roughnessMap,
      });
      this.endMaterial.userData.pbrFamily = 'endgrain';
      this.endMaterial.userData.pbrReady = true;
      this.endMaterial.normalScale.setScalar(.35);
      this.endGeometry = new THREE.CircleGeometry(t.cylinderRadius, 8);
    }

    // Create shared cylinder geometries
    this.hCylinderGeo = new THREE.CylinderGeometry(
      t.cylinderRadius,
      t.cylinderRadius,
      t.width,
      8, 1, !!t.endMaps
    );
    this.hCylinderGeo.rotateZ(Math.PI / 2);

    this.vCylinderGeo = new THREE.CylinderGeometry(
      t.cylinderRadius,
      t.cylinderRadius,
      t.height,
      8, 1, !!t.endMaps
    );
    // Cylinder UV V follows its axis before rotation: grain follows each rail.
    for (const [geometry, length] of [[this.hCylinderGeo, t.width], [this.vCylinderGeo, t.height]]) {
      const uv = geometry.attributes.uv;
      const sideCount = geometry.groups[0]?.count ?? geometry.index.count;
      const sideVertices = new Set(Array.from(geometry.index.array.slice(0, sideCount)));
      for (const i of sideVertices) uv.setY(i, uv.getY(i) * Math.max(1, length / 1.5));
      uv.needsUpdate = true;
    }
    const addEnds = (center, length, horizontal) => {
      if (!this.endGeometry) return;
      for (const sign of [-1, 1]) {
        const end = new THREE.Mesh(this.endGeometry, this.endMaterial);
        end.name = 'Trellis cut end';
        end.position.copy(center);
        if (horizontal) { end.position.x += sign * length / 2; end.rotation.y = sign * Math.PI / 2; }
        else { end.position.y += sign * length / 2; end.rotation.x = -sign * Math.PI / 2; }
        this.add(end);
      }
    };

    // Horizontal lines
    const hLineCount = Math.floor(t.height / t.spacing) + 1;
    for (let i = 0; i < hLineCount; i++) {
      const y = i * t.spacing;
      const mesh = new THREE.Mesh(this.hCylinderGeo, this.material);
      mesh.position.set(t.position.x, t.position.y + y, t.position.z);
      this.add(mesh);
      addEnds(mesh.position, t.width, true);
    }

    // Vertical lines
    const vLineCount = Math.floor(t.width / t.spacing) + 1;
    for (let i = 0; i < vLineCount; i++) {
      const x = -t.width / 2 + i * t.spacing;
      const mesh = new THREE.Mesh(this.vCylinderGeo, this.material);
      mesh.position.set(t.position.x + x, t.position.y + t.height / 2, t.position.z);
      this.add(mesh);
      addEnds(mesh.position, t.height, false);
    }
  }

  /**
   * Find the nearest point on the trellis grid to a given position
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3}
   */
  getNearestPoint(position) {
    const t = this.options;
    const trellisX = t.position.x;
    const trellisY = t.position.y;
    const trellisZ = t.position.z;

    // Trellis bounds
    const minX = trellisX - t.width / 2;
    const maxX = trellisX + t.width / 2;
    const minY = trellisY;
    const maxY = trellisY + t.height;

    // Clamp position to trellis bounds for projection
    const clampedX = Math.max(minX, Math.min(maxX, position.x));
    const clampedY = Math.max(minY, Math.min(maxY, position.y));

    // Find nearest horizontal line (Y = constant)
    const nearestHLineY = Math.round((clampedY - minY) / t.spacing) * t.spacing + minY;
    const finalHLineY = Math.max(minY, Math.min(maxY, nearestHLineY));

    // Find nearest vertical line (X = constant)
    const nearestVLineX = Math.round((clampedX - minX) / t.spacing) * t.spacing + minX;
    const finalVLineX = Math.max(minX, Math.min(maxX, nearestVLineX));

    // Point on nearest horizontal line (X can vary along the line)
    const pointOnHLine = new THREE.Vector3(clampedX, finalHLineY, trellisZ);

    // Point on nearest vertical line (Y can vary along the line)
    const pointOnVLine = new THREE.Vector3(finalVLineX, clampedY, trellisZ);

    // Return whichever is closer
    const distH = position.distanceTo(pointOnHLine);
    const distV = position.distanceTo(pointOnVLine);

    return distH < distV ? pointOnHLine : pointOnVLine;
  }

  /**
   * Clean up geometry and materials
   */
  dispose() {
    this.children.forEach(child => {
      if (child.geometry) {
        child.geometry = null;
      }
    });
    this.clear();

    if (this.hCylinderGeo) {
      this.hCylinderGeo.dispose();
      this.hCylinderGeo = null;
    }
    if (this.vCylinderGeo) {
      this.vCylinderGeo.dispose();
      this.vCylinderGeo = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.endGeometry?.dispose(); this.endGeometry = null;
    this.endMaterial?.dispose(); this.endMaterial = null;
  }
}
