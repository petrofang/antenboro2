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
    sun.position.set(100, 120, 80);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(CONFIG.SHADOW_MAP_SIZE, CONFIG.SHADOW_MAP_SIZE);
    sun.shadow.camera.left = -CONFIG.WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.right = CONFIG.WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.top = CONFIG.WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.bottom = -CONFIG.WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 600;
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
    
    // No height displacement — flat terrain avoids raycasting issues
    // and keeps ants, nests, and food firmly on the ground
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
    
    console.log('✓ Terrain created: size=' + size + 'x' + size);
    return terrain;
  }

  /**
   * Sample terrain height at a world XZ position.
   * Flat terrain — always returns 0.
   */
  getTerrainHeight(worldX, worldZ) {
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
    
    // Main mound — visible landmark, proportional to ant scale
    const moundGeo = new THREE.SphereGeometry(3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
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
    const holeGeo = new THREE.CircleGeometry(0.5, 12);
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 });
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(0.8, 0.05, 0.8);
    group.add(hole);
    
    // Small surrounding dirt piles
    const dirtGeo = new THREE.SphereGeometry(0.6, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const dirt = new THREE.Mesh(dirtGeo, moundMat);
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
      dirt.position.set(Math.cos(a) * 4, 0, Math.sin(a) * 4);
      dirt.scale.setScalar(0.4 + Math.random() * 0.5);
      dirt.castShadow = true;
      group.add(dirt);
    }
    
    return group;
  }

  /**
   * Create an ant mesh with caste-specific visuals:
   *   WORKER  — small, sleek, short mandibles
   *   SOLDIER — medium, large pronounced mandibles (true to real major workers)
   *   QUEEN   — large engorged gaster (abdomen), small head, pulsates
   */
  createAntMesh(id, type, colonyId) {
    const group = new THREE.Group();
    
    const isEnemy = colonyId === 1;
    const isSoldier = type === 'SOLDIER';
    const isQueen = type === 'QUEEN';
    
    // --- Caste-specific proportions ---
    let headR, thoraxR, gasterR, spacing, scale;
    if (isQueen) {
      // Queen: tiny head, normal thorax, huge swollen gaster
      headR = 0.08; thoraxR = 0.12; gasterR = 0.35; spacing = 0.25; scale = 1.5;
    } else if (isSoldier) {
      // Soldier: oversized head (for big mandibles), stocky
      headR = 0.18; thoraxR = 0.16; gasterR = 0.2; spacing = 0.22; scale = 1.0;
    } else {
      // Worker: small, balanced proportions
      headR = 0.1; thoraxR = 0.12; gasterR = 0.15; spacing = 0.18; scale = 0.7;
    }
    
    // --- Colony color ---
    let bodyMaterial;
    if (isEnemy) {
      bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b2500, roughness: 0.6, metalness: 0.05,
        emissive: 0x3a0800, emissiveIntensity: 0.15,
      });
    } else {
      bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1e, roughness: 0.55, metalness: 0.05,
        emissive: 0x050508, emissiveIntensity: 0.1,
      });
    }
    
    // --- Body segments ---
    const headGeometry = new THREE.SphereGeometry(headR * scale, 8, 8);
    const thoraxGeometry = new THREE.SphereGeometry(thoraxR * scale, 8, 8);
    const gasterGeometry = new THREE.SphereGeometry(gasterR * scale, 8, 8);
    
    const head = new THREE.Mesh(headGeometry, bodyMaterial);
    const thorax = new THREE.Mesh(thoraxGeometry, bodyMaterial);
    const gaster = new THREE.Mesh(gasterGeometry, bodyMaterial);
    
    head.position.z = spacing * scale * 1.5;
    thorax.position.z = 0;
    gaster.position.z = -spacing * scale * 1.5;
    
    // Queen gaster is elongated (squish Y, stretch Z for physogastric look)
    if (isQueen) {
      gaster.scale.set(1, 0.8, 1.4);
    }
    
    head.castShadow = true;
    thorax.castShadow = true;
    gaster.castShadow = true;
    group.add(head);
    group.add(thorax);
    group.add(gaster);
    
    // --- Mandibles ---
    // Soldiers get massive mandibles; workers get tiny ones; queen has none
    if (isSoldier) {
      const mGeo = new THREE.ConeGeometry(0.06 * scale, 0.35 * scale, 4);
      const mMat = new THREE.MeshStandardMaterial({
        color: 0x4a2800, roughness: 0.3, metalness: 0.3,
      });
      const m1 = new THREE.Mesh(mGeo, mMat);
      const m2 = new THREE.Mesh(mGeo, mMat);
      const headZ = head.position.z;
      m1.position.set(-0.1 * scale, -0.02 * scale, headZ + headR * scale * 0.8);
      m1.rotation.x = Math.PI / 2;
      m1.rotation.z = 0.4;
      m2.position.set(0.1 * scale, -0.02 * scale, headZ + headR * scale * 0.8);
      m2.rotation.x = Math.PI / 2;
      m2.rotation.z = -0.4;
      m1.castShadow = true;
      m2.castShadow = true;
      group.add(m1);
      group.add(m2);
    } else if (!isQueen) {
      // Workers: small mandibles
      const mGeo = new THREE.ConeGeometry(0.02 * scale, 0.1 * scale, 4);
      const mMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4 });
      const m1 = new THREE.Mesh(mGeo, mMat);
      const m2 = new THREE.Mesh(mGeo, mMat);
      const headZ = head.position.z;
      m1.position.set(-0.05 * scale, 0, headZ + headR * scale * 0.7);
      m1.rotation.x = Math.PI / 2;
      m1.rotation.z = 0.3;
      m2.position.set(0.05 * scale, 0, headZ + headR * scale * 0.7);
      m2.rotation.x = Math.PI / 2;
      m2.rotation.z = -0.3;
      group.add(m1);
      group.add(m2);
    }
    
    // --- Antennae ---
    const antennaGeo = new THREE.CylinderGeometry(0.01 * scale, 0.005 * scale, 0.3 * scale, 4);
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const a1 = new THREE.Mesh(antennaGeo, antennaMat);
    const a2 = new THREE.Mesh(antennaGeo, antennaMat);
    const antZ = head.position.z + headR * scale * 0.5;
    a1.position.set(-0.06 * scale, 0.04 * scale, antZ);
    a1.rotation.x = -0.4;
    a1.rotation.z = -0.2;
    a2.position.set(0.06 * scale, 0.04 * scale, antZ);
    a2.rotation.x = -0.4;
    a2.rotation.z = 0.2;
    group.add(a1);
    group.add(a2);
    
    // --- Legs (6) ---
    const legGeo = new THREE.CylinderGeometry(0.012 * scale, 0.008 * scale, 0.2 * scale, 4);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const leg = new THREE.Mesh(legGeo, legMat);
      const side = i < 3 ? -1 : 1;
      const pair = i % 3;
      leg.position.set(
        side * thoraxR * scale * 0.9,
        -thoraxR * scale * 0.7,
        (pair - 1) * spacing * scale * 0.8
      );
      leg.rotation.z = side * 0.4;
      group.add(leg);
      legs.push(leg);
    }
    
    // Store metadata for animation
    group.userData.antType = type;
    group.userData.isQueen = isQueen;
    group.userData.birthTick = performance.now();
    
    this.scene.add(group);
    this.antMeshes.set(id, group);
    this.antBodies.set(id, { head, thorax, gaster, legs });
    
    return group;
  }

  /**
   * Update ant mesh position, rotation, and animation.
   */
  updateAntMesh(id, x, y, angle, height = 0) {
    const mesh = this.antMeshes.get(id);
    if (!mesh) return;
    
    const worldX = (x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
    const worldZ = (y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
    const terrainY = this.getTerrainHeight(worldX, worldZ);
    mesh.position.set(worldX, terrainY + 0.05, worldZ);
    mesh.rotation.y = Math.PI / 2 - angle;
    
    // Queen pulsating abdomen animation
    if (mesh.userData.isQueen) {
      const bodies = this.antBodies.get(id);
      if (bodies && bodies.gaster) {
        const t = performance.now() * 0.003;
        const pulse = 1.0 + Math.sin(t) * 0.12;
        bodies.gaster.scale.set(pulse, 0.8 * pulse, 1.4 * pulse);
      }
    }
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
