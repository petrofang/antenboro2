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
    
    // Food meshes (index → mesh)
    this.foodMeshes = [];
    
    // Nest meshes
    this.nestMeshes = [];
    
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
    
    // Raycaster for terrain height sampling
    this._terrainRaycaster = new THREE.Raycaster();
    this._terrainRayOrigin = new THREE.Vector3();
    this._terrainRayDir = new THREE.Vector3(0, -1, 0);
    
    console.log('✓ Terrain created: size=' + size + 'x' + size + ', segments=' + segments);
    return terrain;
  }

  /**
   * Sample terrain height at a world XZ position.
   * Returns the Y value of the terrain surface, or 0 if no hit.
   */
  getTerrainHeight(worldX, worldZ) {
    if (!this.terrain) return 0;
    
    this._terrainRayOrigin.set(worldX, 50, worldZ);
    this._terrainRaycaster.set(this._terrainRayOrigin, this._terrainRayDir);
    
    const hits = this._terrainRaycaster.intersectObject(this.terrain);
    if (hits.length > 0) {
      return hits[0].point.y;
    }
    return 0;
  }
  
  /**
   * Create 3D representations of food patches from the simulation.
   */
  createFoodMeshes(foodPatches) {
    // Remove old food meshes
    for (const m of this.foodMeshes) {
      this.scene.remove(m);
    }
    this.foodMeshes = [];
    
    const geometry = new THREE.SphereGeometry(0.3, 8, 6);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      roughness: 0.6,
      metalness: 0.0,
      emissive: 0x664400,
      emissiveIntensity: 0.3,
    });
    
    for (let i = 0; i < foodPatches.length; i++) {
      const food = foodPatches[i];
      const group = new THREE.Group();
      
      // Create a cluster of small spheres to represent food pile
      const count = Math.min(Math.ceil(food.amount / 5), 8);
      for (let j = 0; j < count; j++) {
        const sphere = new THREE.Mesh(geometry, material);
        const angle = (j / count) * Math.PI * 2;
        const dist = 0.3 + Math.random() * 0.3;
        sphere.position.set(
          Math.cos(angle) * dist,
          0.15 + Math.random() * 0.2,
          Math.sin(angle) * dist
        );
        sphere.scale.setScalar(0.5 + Math.random() * 0.5);
        sphere.castShadow = true;
        group.add(sphere);
      }
      
      const worldX = (food.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
      const worldZ = (food.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
      // Will set Y after terrain is available
      group.position.set(worldX, 0, worldZ);
      group.userData.worldX = worldX;
      group.userData.worldZ = worldZ;
      
      this.scene.add(group);
      this.foodMeshes.push(group);
    }
    
    console.log('✓ Food meshes created: ' + foodPatches.length + ' patches');
  }

  /**
   * Snap food and nest meshes to terrain height (call after terrain is created).
   */
  snapWorldObjectsToTerrain() {
    for (const mesh of this.foodMeshes) {
      const h = this.getTerrainHeight(mesh.userData.worldX, mesh.userData.worldZ);
      mesh.position.y = h;
    }
    for (const mesh of this.nestMeshes) {
      const h = this.getTerrainHeight(mesh.position.x, mesh.position.z);
      mesh.position.y = h;
    }
  }

  /**
   * Update food mesh visibility based on remaining amount.
   */
  updateFoodMeshes(foodPatches) {
    for (let i = 0; i < foodPatches.length && i < this.foodMeshes.length; i++) {
      const food = foodPatches[i];
      const mesh = this.foodMeshes[i];
      
      if (food.amount <= 0) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        // Scale based on remaining food
        const scale = Math.max(0.2, food.amount / CONFIG.FOOD_PER_CLUSTER);
        mesh.scale.setScalar(scale);
      }
    }
  }

  /**
   * Create 3D nest markers for both colonies.
   */
  createNestMeshes() {
    // Player nest (green mound)
    const playerNest = this._createNestMesh(0x00cc44, 0x004411);
    const pnx = (CONFIG.PLAYER_COLONY_NEST_X - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
    const pnz = (CONFIG.PLAYER_COLONY_NEST_Y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
    playerNest.position.set(pnx, 0, pnz);
    this.scene.add(playerNest);
    this.nestMeshes.push(playerNest);
    
    // Enemy nest (red mound)
    const enemyNest = this._createNestMesh(0xcc3333, 0x441111);
    const enx = (CONFIG.ENEMY_COLONY_NEST_X - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
    const enz = (CONFIG.ENEMY_COLONY_NEST_Y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
    enemyNest.position.set(enx, 0, enz);
    this.scene.add(enemyNest);
    this.nestMeshes.push(enemyNest);
    
    console.log('✓ Nest meshes created');
  }
  
  _createNestMesh(color, emissive) {
    const group = new THREE.Group();
    
    // Main mound
    const moundGeo = new THREE.SphereGeometry(1.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const moundMat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.9,
      metalness: 0.0,
      emissive: emissive,
      emissiveIntensity: 0.4,
    });
    const mound = new THREE.Mesh(moundGeo, moundMat);
    mound.castShadow = true;
    mound.receiveShadow = true;
    group.add(mound);
    
    // Entrance hole (dark disc)
    const holeGeo = new THREE.CircleGeometry(0.4, 12);
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 });
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(0.5, 0.05, 0.5);
    group.add(hole);
    
    // Small surrounding dirt piles
    const dirtGeo = new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const dirt = new THREE.Mesh(dirtGeo, moundMat);
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
      dirt.position.set(Math.cos(a) * 2, 0, Math.sin(a) * 2);
      dirt.scale.setScalar(0.5 + Math.random() * 0.5);
      dirt.castShadow = true;
      group.add(dirt);
    }
    
    return group;
  }

  /**
   * Create an ant mesh at a given position.
   * Returns an Object3D with body (segmented ellipsoids), legs, mandibles.
   */
  createAntMesh(id, type, colonyId) {
    const group = new THREE.Group();
    
    // Determine color and size
    const isEnemy = colonyId === 1;
    const isSoldier = type === 'SOLDIER';
    const isQueen = type === 'QUEEN';
    const scale = isQueen ? 1.2 : (isSoldier ? 1.0 : 0.7);
    
    // Body segments (3 ellipsoids: head, thorax, gaster)
    const headGeometry = new THREE.SphereGeometry(0.15 * scale, 8, 8);
    const thoraxGeometry = new THREE.SphereGeometry(0.2 * scale, 8, 8);
    const gasterGeometry = new THREE.SphereGeometry(0.25 * scale, 8, 8);
    
    // Realistic ant colors: player = dark brown/black, enemy = reddish-brown
    let bodyMaterial;
    if (isEnemy) {
      bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b2500,
        roughness: 0.6,
        metalness: 0.05,
        emissive: 0x3a0800,
        emissiveIntensity: 0.15,
      });
    } else {
      bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1e,
        roughness: 0.55,
        metalness: 0.05,
        emissive: 0x050508,
        emissiveIntensity: 0.1,
      });
    }
    
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
    
    // Sample terrain height so ants sit on the surface
    const terrainY = this.getTerrainHeight(worldX, worldZ);
    mesh.position.set(worldX, terrainY + 0.3, worldZ);
    // Ant model faces +Z; convert grid angle to correct Y rotation.
    mesh.rotation.y = Math.PI / 2 - angle;
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
