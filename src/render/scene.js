import * as THREE from 'three';
import CONFIG from '../sim/config.js';

/**
 * Three.js scene setup with PBR materials and post-processing.
 */
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.PLAYER_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.mapSize = new THREE.Vector2(CONFIG.SHADOW_MAP_SIZE, CONFIG.SHADOW_MAP_SIZE);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    
    // Camera position - start above and behind terrain
    this.camera.position.set(0, 15, 25);
    this.camera.lookAt(0, 5, 0);
    
    // Fog
    this.scene.fog = new THREE.Fog(CONFIG.FOG_COLOR, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);
    this.scene.background = new THREE.Color(CONFIG.FOG_COLOR);
    
    // Lights
    this._setupLights();
    
    // Terrain & world meshes
    this.terrain = null;
    this.worldObjects = [];
    
    // Ant meshes
    this.antMeshes = new Map(); // id → mesh
    this.antBodies = new Map();  // id → { body, legs, mandibles }
    
    // EffectComposer will be set up in another method
    this.composer = null;
    
    // Handle window resize
    window.addEventListener('resize', () => this._onWindowResize());
  }

  _setupLights() {
    // Ambient light - brighten it to ensure visibility
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);
    
    // Directional light (sun) - positioned clearly above
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(50, 50, 50);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(CONFIG.SHADOW_MAP_SIZE, CONFIG.SHADOW_MAP_SIZE);
    sun.shadow.camera.left = -CONFIG.WORLD_SIZE_3D * 1.5;
    sun.shadow.camera.right = CONFIG.WORLD_SIZE_3D * 1.5;
    sun.shadow.camera.top = CONFIG.WORLD_SIZE_3D * 1.5;
    sun.shadow.camera.bottom = -CONFIG.WORLD_SIZE_3D * 1.5;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    this.scene.add(sun);
    this.scene.add(sun.target);
    
    // Hemisphere light for ambient color
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.5);
    this.scene.add(hemiLight);
    
    console.log('✓ Lights set up: ambient + directional + hemisphere');
  }

  _onWindowResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
    }
  }

  /**
   * Create a simple terrain mesh (flat plane with height variation).
   */
  createTerrain() {
    const size = CONFIG.WORLD_SIZE_3D;
    const segments = 64;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    
    // Vertex displacement for terrain height
    const positionAttribute = geometry.getAttribute('position');
    const positions = positionAttribute.array;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 1];
      // Subtle noise for terrain
      const height = Math.sin(x * 0.3) * 0.3 + Math.cos(z * 0.3) * 0.3 + Math.random() * 0.1;
      positions[i + 2] = height;
    }
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    
    // Material with PBR
    const material = new THREE.MeshStandardMaterial({
      color: 0x3d6b2a,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    // Rotate to be horizontal (XZ plane)
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = 0;
    
    this.scene.add(terrain);
    this.terrain = terrain;
    console.log('✓ Terrain created: size=' + size + 'x' + size + ', segments=' + segments);
    return terrain;
  }
  
  /**
   * Create a debug test cube to verify rendering works.
   */
  createTestCube() {
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      roughness: 0.5,
      metalness: 0.1,
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(0, 3, 0);
    cube.castShadow = true;
    cube.receiveShadow = true;
    this.scene.add(cube);
    console.log('✓ Test cube created at (0, 3, 0)');
    return cube;
  }

  /**
   * Create an ant mesh at a given position.
   * Returns an Object3D with body (segmented ellipsoids), legs, mandibles.
   */
  createAntMesh(id, type, colonyId) {
    const group = new THREE.Group();
    
    // Determine color and size
    const isEnemy = colonyId === 1;
    const bodyColor = isEnemy ? 0xcc3333 : 0x000000;
    const isSoldier = type === 'SOLDIER';
    const scale = isSoldier ? 1.3 : 1.0;
    
    // Body segments (3 ellipsoids: head, thorax, gaster)
    const headGeometry = new THREE.SphereGeometry(0.15 * scale, 8, 8);
    const thoraxGeometry = new THREE.SphereGeometry(0.2 * scale, 8, 8);
    const gasterGeometry = new THREE.SphereGeometry(0.25 * scale, 8, 8);
    
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.4,
      metalness: 0.1,
    });
    
    const head = new THREE.Mesh(headGeometry, bodyMaterial);
    const thorax = new THREE.Mesh(thoraxGeometry, bodyMaterial);
    const gaster = new THREE.Mesh(gasterGeometry, bodyMaterial);
    
    head.position.z = 0.3 * scale;
    thorax.position.z = 0;
    gaster.position.z = -0.3 * scale;
    
    head.castShadow = true;
    thorax.castShadow = true;
    gaster.castShadow = true;
    
    group.add(head);
    group.add(thorax);
    group.add(gaster);
    
    // Mandibles (small cones on head)
    if (isSoldier || type === 'QUEEN') {
      const mandibleGeometry = new THREE.ConeGeometry(0.08 * scale, 0.25 * scale, 4);
      const mandibleMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.3,
        metalness: 0.2,
      });
      const mandible1 = new THREE.Mesh(mandibleGeometry, mandibleMaterial);
      const mandible2 = new THREE.Mesh(mandibleGeometry, mandibleMaterial);
      mandible1.position.set(-0.1 * scale, 0, 0.35 * scale);
      mandible1.rotation.z = 0.3;
      mandible2.position.set(0.1 * scale, 0, 0.35 * scale);
      mandible2.rotation.z = -0.3;
      mandible1.castShadow = true;
      mandible2.castShadow = true;
      group.add(mandible1);
      group.add(mandible2);
    }
    
    // Antennae (thin cylinders)
    const antennaGeometry = new THREE.CylinderGeometry(0.02 * scale, 0.01 * scale, 0.4 * scale, 4);
    const antennaMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.5,
    });
    const antenna1 = new THREE.Mesh(antennaGeometry, antennaMaterial);
    const antenna2 = new THREE.Mesh(antennaGeometry, antennaMaterial);
    antenna1.position.set(-0.12 * scale, 0, 0.35 * scale);
    antenna1.rotation.x = -0.3;
    antenna2.position.set(0.12 * scale, 0, 0.35 * scale);
    antenna2.rotation.x = -0.3;
    group.add(antenna1);
    group.add(antenna2);
    
    // Simple legs (6 cylinders, 3 per side)
    const legGeometry = new THREE.CylinderGeometry(0.02 * scale, 0.015 * scale, 0.3 * scale, 4);
    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.6,
    });
    
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      const side = i < 3 ? -1 : 1;
      const offset = i % 3;
      leg.position.set(
        side * 0.15 * scale,
        -0.15 * scale,
        (offset - 1) * 0.2 * scale
      );
      leg.rotation.z = side * 0.3;
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);
    }
    
    this.scene.add(group);
    this.antMeshes.set(id, group);
    this.antBodies.set(id, { head, thorax, gaster, legs });
    
    return group;
  }

  /**
   * Update ant mesh position and rotation based on sim state.
   */
  updateAntMesh(id, x, y, angle, height = 0) {
    const mesh = this.antMeshes.get(id);
    if (!mesh) return;
    
    // Convert grid coordinates to 3D world
    const worldX = (x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
    const worldZ = (y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
    
    mesh.position.set(worldX, height + 0.2, worldZ);
    mesh.rotation.z = angle; // Rotate around vertical axis (simplified)
  }

  /**
   * Remove ant mesh.
   */
  removeAntMesh(id) {
    const mesh = this.antMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      this.antMeshes.delete(id);
      this.antBodies.delete(id);
    }
  }

  /**
   * Render a single frame.
   */
  render() {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Dispose resources.
   */
  dispose() {
    this.renderer.dispose();
  }
}

export default SceneManager;
