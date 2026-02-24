import * as THREE from 'three';
import CONFIG from '../sim/config.js';

/**
 * Underground 3D scene — renders the colony's tunnel network
 * and chambers as a separate Three.js scene.
 *
 * Visual style: earthy brown tube corridors, dim warm point lights,
 * cave-like chamber rooms, short-range fog for atmosphere.
 */
export class UndergroundRenderer {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;

    // Separate scene for underground
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0804);
    this.scene.fog = new THREE.Fog(0x0a0804, 2, 14); // short dark fog, pushed out so entrance reads clearly

    // Materials
    this.tunnelMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b4226,      // earthy brown
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.BackSide,  // render inside of tube
    });

    this.chamberMaterial = new THREE.MeshStandardMaterial({
      color: 0x7a5230,      // slightly warmer brown
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.BackSide,  // see interior walls
    });

    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3218,
      roughness: 1.0,
      metalness: 0.0,
    });

    // Track meshes for rebuild
    this.tunnelMeshes = [];
    this.chamberMeshes = [];
    this.lightObjects = [];

    // Ant + brood meshes stored here when underground
    this.antMeshes = new Map();
    this.broodMeshes = new Map();

    // Setup base lighting
    this._setupLighting();
  }

  _setupLighting() {
    // Moderate ambient — light permeates slightly through soil
    const ambient = new THREE.AmbientLight(0x665544, 0.5);
    this.scene.add(ambient);

    // Hemisphere light — warm ground below, cool sky tint from entrance above
    const hemi = new THREE.HemisphereLight(0x8899aa, 0x554433, 0.3);
    this.scene.add(hemi);
  }

  /**
   * Rebuild the entire underground mesh network from graph data.
   * Called when tunnels are dug or chambers are built.
   * @param {ColonyUnderground} underground
   */
  rebuild(underground) {
    // Clear old geometry
    this._clearMeshes();

    // Build tunnel tubes for each edge
    for (const edge of underground.edges.values()) {
      if (!edge.built) continue;
      const from = underground.getNode(edge.fromId);
      const to = underground.getNode(edge.toId);
      if (!from || !to) continue;

      this._createTunnelMesh(from, to, edge.width);
    }

    // Build chamber rooms for each node
    for (const node of underground.nodes.values()) {
      if (!node.built) continue;
      this._createChamberMesh(node);
    }

    console.log(`✓ Underground rebuilt: ${underground.nodes.size} nodes, ${underground.edges.size} edges`);
  }

  /**
   * Create a tube corridor between two nodes.
   */
  _createTunnelMesh(from, to, width) {
    const points = [
      new THREE.Vector3(from.x, from.y, from.z),
      // Midpoint with slight sag for natural look
      new THREE.Vector3(
        (from.x + to.x) / 2,
        (from.y + to.y) / 2 - 0.1,
        (from.z + to.z) / 2
      ),
      new THREE.Vector3(to.x, to.y, to.z),
    ];

    const path = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(path, 16, width, 8, false);
    const tube = new THREE.Mesh(tubeGeo, this.tunnelMaterial);
    tube.receiveShadow = true;

    // Point lights along the tunnel so corridors are navigable
    const numLights = Math.max(1, Math.floor(path.getLength() / 2.5));
    for (let i = 0; i <= numLights; i++) {
      const t = i / numLights;
      const p = path.getPointAt(t);
      const tLight = new THREE.PointLight(0xaa8866, 0.4, 3.5, 2);
      tLight.position.set(p.x, p.y + width * 0.3, p.z);
      this.scene.add(tLight);
      this.lightObjects.push(tLight);
    }

    // Floor strip inside tunnel (flat walkable surface)
    const floorPoints = [];
    const divisions = 16;
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      const p = path.getPointAt(t);
      floorPoints.push(p);
    }
    const floorGeo = this._createTunnelFloor(floorPoints, width * 0.8);
    const floor = new THREE.Mesh(floorGeo, this.floorMaterial);
    floor.receiveShadow = true;

    this.scene.add(tube);
    this.scene.add(floor);
    this.tunnelMeshes.push(tube, floor);
  }

  /**
   * Create a flat floor strip along a tunnel path.
   */
  _createTunnelFloor(pathPoints, halfWidth) {
    const vertices = [];
    const indices = [];

    for (let i = 0; i < pathPoints.length; i++) {
      const p = pathPoints[i];
      // Get tangent direction for perpendicular
      let tangent;
      if (i < pathPoints.length - 1) {
        tangent = new THREE.Vector3().subVectors(pathPoints[i + 1], p).normalize();
      } else {
        tangent = new THREE.Vector3().subVectors(p, pathPoints[i - 1]).normalize();
      }

      // Perpendicular in XZ plane
      const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      // Two vertices: left and right of center, at the bottom of the tunnel
      const floorY = p.y - halfWidth * 0.4;
      vertices.push(
        p.x - perp.x * halfWidth, floorY, p.z - perp.z * halfWidth,
        p.x + perp.x * halfWidth, floorY, p.z + perp.z * halfWidth
      );
    }

    for (let i = 0; i < pathPoints.length - 1; i++) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Create a chamber room (spherical interior or half-sphere dome).
   */
  _createChamberMesh(node) {
    const r = node.radius;
    const isEntrance = node.type === 'entrance';

    if (isEntrance) {
      // Entrance: earthy half-dome walls (lower portion of sphere)
      // The top is open — that's where the sky is visible
      const domeGeo = new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65);
      const chamber = new THREE.Mesh(domeGeo, this.chamberMaterial);
      chamber.position.set(node.x, node.y, node.z);
      chamber.receiveShadow = true;
      this.scene.add(chamber);
      this.chamberMeshes.push(chamber);

      // Sky disc at the top — the open hole to the outside
      const holeGeo = new THREE.CircleGeometry(r * 0.55, 16);
      const holeMat = new THREE.MeshStandardMaterial({
        color: 0x99ccee,
        emissive: 0x88bbdd,
        emissiveIntensity: 0.7,
        roughness: 0.0,
        side: THREE.DoubleSide,
      });
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(node.x, node.y + r * 0.7, node.z);
      this.scene.add(hole);
      this.chamberMeshes.push(hole);

      // Strong daylight pouring down from the hole
      const sunLight = new THREE.PointLight(0xddeeff, 1.8, r * 6, 2);
      sunLight.position.set(node.x, node.y + r * 0.6, node.z);
      this.scene.add(sunLight);
      this.lightObjects.push(sunLight);
    } else {
      // Standard inverted sphere for chamber interior
      const sphereGeo = new THREE.SphereGeometry(r, 16, 12);
      const chamber = new THREE.Mesh(sphereGeo, this.chamberMaterial);
      chamber.position.set(node.x, node.y, node.z);
      chamber.receiveShadow = true;
      this.scene.add(chamber);
      this.chamberMeshes.push(chamber);
    }

    // Flat floor disc inside chamber
    const floorGeo = new THREE.CircleGeometry(r * 0.85, 16);
    const floorMat = isEntrance
      ? new THREE.MeshStandardMaterial({
          color: 0x8a7a60,
          roughness: 0.8,
          metalness: 0.0,
        })
      : this.floorMaterial;
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(node.x, node.y - r * 0.45, node.z);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.chamberMeshes.push(floor);

    // Point light in chamber (warm glow) — entrance uses its own sunLight above
    if (!isEntrance) {
      const light = new THREE.PointLight(
        this._getChamberLightColor(node.type),
        0.6,
        r * 4,
        2
      );
      light.position.set(node.x, node.y + r * 0.2, node.z);
      this.scene.add(light);
      this.lightObjects.push(light);
    }

    // Type label (as a small glowing marker on the floor)
    if (node.type !== 'entrance' && node.type !== 'tunnel_junction') {
      const markerGeo = new THREE.SphereGeometry(0.08, 6, 6);
      const markerMat = new THREE.MeshStandardMaterial({
        color: this._getChamberLightColor(node.type),
        emissive: this._getChamberLightColor(node.type),
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(node.x, node.y - r * 0.4, node.z);
      this.scene.add(marker);
      this.chamberMeshes.push(marker);
    }
  }

  _getChamberLightColor(type) {
    switch (type) {
      case 'entrance':        return 0xaaccff; // daylight blue
      case 'queen_chamber':   return 0xffcc66; // warm gold
      case 'nursery':         return 0xffddaa; // soft warm
      case 'food_store':      return 0xffaa33; // amber
      case 'barracks':        return 0xff6644; // reddish
      case 'tunnel_junction': return 0x886644; // dim brown
      default:                return 0x997744;
    }
  }

  _clearMeshes() {
    for (const m of this.tunnelMeshes) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    for (const m of this.chamberMeshes) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    for (const l of this.lightObjects) {
      this.scene.remove(l);
    }
    this.tunnelMeshes = [];
    this.chamberMeshes = [];
    this.lightObjects = [];
  }

  // ─── QUEEN & BROOD RENDERING ──────────────────────────────────────

  /**
   * Create or update queen mesh in the underground scene.
   * Uses the same mesh creation as the surface, but positioned in
   * the queen chamber.
   */
  updateQueen(queenMesh, chamberNode) {
    if (!queenMesh || !chamberNode) return;
    // Position queen on the chamber floor
    queenMesh.position.set(
      chamberNode.x,
      chamberNode.y - chamberNode.radius * 0.4 + 0.15,
      chamberNode.z
    );
  }

  /**
   * Render the underground scene.
   */
  render(camera) {
    this.renderer.render(this.scene, camera);
  }

  dispose() {
    this._clearMeshes();
  }
}

export default UndergroundRenderer;
