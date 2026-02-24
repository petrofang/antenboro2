import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
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
    
    // Hit-flash shared material (white emissive)
    this.flashMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.2,
    });

    // Dying ants tracking (meshKey → { timer, duration })
    this.dyingAnts = new Map();

    // --- Particle system (fixed-size Points buffer) ---
    this.MAX_PARTICLES = 500;
    const pGeo = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.MAX_PARTICLES * 3);
    this.particleVelocities = new Float32Array(this.MAX_PARTICLES * 3);
    this.particleLifetimes = new Float32Array(this.MAX_PARTICLES);
    this.particleColors = new Float32Array(this.MAX_PARTICLES * 3);
    // Hide all particles initially
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particlePositions[i * 3 + 1] = -999;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.08, vertexColors: true, transparent: true,
      opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(pGeo, pMat);
    this.particles.frustumCulled = false;
    this.nextParticleIdx = 0;

    // --- Bloom post-processing ---
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
    const segments = 128;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    
    // Vertex displacement for rolling hills
    const positionAttribute = geometry.getAttribute('position');
    const positions = positionAttribute.array;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];       // local X → world X
      const y = positions[i + 1];   // local Y → world -Z
      // Gentle rolling terrain
      const height = Math.sin(x * 0.08) * 0.5
                   + Math.cos(y * 0.08) * 0.5
                   + Math.sin(x * 0.03 + y * 0.04) * 0.3;
      positions[i + 2] = height;
    }
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x3d6b2a,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = 0;
    
    this.scene.add(terrain);
    this.terrain = terrain;
    
    console.log('✓ Terrain created: size=' + size + 'x' + size + ', segments=' + segments);
    return terrain;
  }

  /**
   * Analytical terrain height at a world XZ position.
   * Uses the same formula as vertex displacement — no raycaster needed.
   * Local X = world X, local Y = -world Z (due to rotation.x = -PI/2).
   */
  getTerrainHeight(worldX, worldZ) {
    const localY = -worldZ; // local Y maps to world -Z
    return Math.sin(worldX * 0.08) * 0.5
         + Math.cos(localY * 0.08) * 0.5
         + Math.sin(worldX * 0.03 + localY * 0.04) * 0.3;
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
   * Create anatomically-detailed ant mesh with caste-specific visuals.
   *
   * Real ant (Formicidae) morphology reference:
   *   HEAD (caput)    — trapezoidal, flattened dorso-ventrally, compound eyes on sides
   *   MESOSOMA        — elongated thorax, slightly flattened, all 3 leg pairs attach here
   *   PETIOLE         — narrow waist node(s) connecting thorax to gaster (KEY ant feature)
   *   GASTER          — teardrop/ovoid abdomen, pointed at rear tip
   *   MANDIBLES       — curved triangular plates, huge in soldiers (major workers)
   *   ANTENNAE        — elbowed: scape (base rod) + funiculus (angled whip)
   *   LEGS            — 3 pairs, each with femur + tibia segments joined at an angle
   *
   * Caste differences:
   *   WORKER  — balanced proportions, small mandibles
   *   SOLDIER — same thorax/gaster, MUCH larger head + massive mandibles
   *   QUEEN   — normal head, elongated thorax, hugely distended physogastric gaster
   */
  createAntMesh(id, type, colonyId) {
    const group = new THREE.Group();

    const isEnemy = colonyId === 1;
    const isSoldier = type === 'SOLDIER';
    const isQueen = type === 'QUEEN';

    // ─── Base unit scale (all measurements relative to this) ─────
    const U = isQueen ? 1.4 : (isSoldier ? 0.85 : 0.65);

    // ─── Colony body material ─────
    const bodyMaterial = isEnemy
      ? new THREE.MeshStandardMaterial({
          color: 0x6b1c00, roughness: 0.55, metalness: 0.08,
          emissive: 0x2a0600, emissiveIntensity: 0.12,
        })
      : new THREE.MeshStandardMaterial({
          color: 0x1a1a1e, roughness: 0.5, metalness: 0.08,
          emissive: 0x050508, emissiveIntensity: 0.08,
        });

    // Slightly glossier chitin material for head + mandibles
    const chitinMaterial = isEnemy
      ? new THREE.MeshStandardMaterial({
          color: 0x5a1800, roughness: 0.35, metalness: 0.15,
          emissive: 0x200500, emissiveIntensity: 0.1,
        })
      : new THREE.MeshStandardMaterial({
          color: 0x151518, roughness: 0.3, metalness: 0.15,
          emissive: 0x040406, emissiveIntensity: 0.08,
        });

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, roughness: 0.6, metalness: 0.1,
    });

    // ─────────────────────────────────────────────────────────────
    //  HEAD — trapezoidal shape via squashed sphere
    // ─────────────────────────────────────────────────────────────
    let headW, headH, headD;
    if (isSoldier) {
      // Soldiers: disproportionately large, wide head
      headW = 0.22 * U; headH = 0.13 * U; headD = 0.20 * U;
    } else if (isQueen) {
      // Queen: proportional head (not tiny — real queens have normal heads)
      headW = 0.12 * U; headH = 0.09 * U; headD = 0.12 * U;
    } else {
      // Worker: balanced head
      headW = 0.12 * U; headH = 0.08 * U; headD = 0.11 * U;
    }
    const headGeo = new THREE.SphereGeometry(1, 10, 8);
    const head = new THREE.Mesh(headGeo, chitinMaterial);
    head.scale.set(headW, headH, headD);

    // Compound eyes (small dark bumps on sides of head)
    const eyeGeo = new THREE.SphereGeometry(0.03 * U, 6, 6);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x111111, roughness: 0.2, metalness: 0.4,
    });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-headW * 0.75, headH * 0.3, headD * 0.2);
    eyeR.position.set(headW * 0.75, headH * 0.3, headD * 0.2);
    head.add(eyeL);
    head.add(eyeR);

    // ─────────────────────────────────────────────────────────────
    //  MESOSOMA (thorax) — elongated, slightly flattened oval
    // ─────────────────────────────────────────────────────────────
    let thoraxW, thoraxH, thoraxD;
    if (isQueen) {
      // Queen: elongated thorax (to support wing muscles historically)
      thoraxW = 0.10 * U; thoraxH = 0.09 * U; thoraxD = 0.18 * U;
    } else {
      thoraxW = 0.10 * U; thoraxH = 0.08 * U; thoraxD = 0.15 * U;
    }
    const thoraxGeo = new THREE.SphereGeometry(1, 10, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMaterial);
    thorax.scale.set(thoraxW, thoraxH, thoraxD);

    // ─────────────────────────────────────────────────────────────
    //  PETIOLE — narrow waist node (THE defining ant feature)
    // ─────────────────────────────────────────────────────────────
    const petioleR = 0.03 * U;
    const petioleGeo = new THREE.SphereGeometry(1, 6, 6);
    const petiole = new THREE.Mesh(petioleGeo, bodyMaterial);
    petiole.scale.set(petioleR * 1.2, petioleR, petioleR);

    // ─────────────────────────────────────────────────────────────
    //  GASTER (abdomen) — teardrop ovoid, pointed at rear
    // ─────────────────────────────────────────────────────────────
    let gasterW, gasterH, gasterD;
    if (isQueen) {
      // Physogastric queen: hugely distended, elongated gaster
      gasterW = 0.20 * U; gasterH = 0.17 * U; gasterD = 0.35 * U;
    } else if (isSoldier) {
      gasterW = 0.13 * U; gasterH = 0.10 * U; gasterD = 0.16 * U;
    } else {
      gasterW = 0.12 * U; gasterH = 0.09 * U; gasterD = 0.15 * U;
    }
    const gasterGeo = new THREE.SphereGeometry(1, 10, 8);
    const gaster = new THREE.Mesh(gasterGeo, bodyMaterial);
    gaster.scale.set(gasterW, gasterH, gasterD);

    // Gaster tip (pointed end / acidopore)
    const tipGeo = new THREE.ConeGeometry(0.025 * U, 0.06 * U, 6);
    const gasterTip = new THREE.Mesh(tipGeo, bodyMaterial);
    gasterTip.rotation.x = Math.PI / 2; // point backward
    gasterTip.position.z = -gasterD * 0.9;
    gaster.add(gasterTip);

    // ─── Position body segments along Z axis (front → back) ─────
    // Segments connect touching: each placed so surfaces meet
    const headZ    = (thoraxD + headD) * 0.85;        // head front of thorax
    const thoraxZ  = 0;                                // thorax at origin
    const petioleZ = -(thoraxD + petioleR * 1.1);     // petiole behind thorax
    const gasterZ  = petioleZ - (petioleR + gasterD) * 0.9; // gaster behind petiole

    head.position.set(0, headH * 0.15, headZ);
    thorax.position.set(0, 0, thoraxZ);
    petiole.position.set(0, -thoraxH * 0.15, petioleZ);
    gaster.position.set(0, -thoraxH * 0.1, gasterZ);

    // Slight head tilt down (ants look downward naturally)
    head.rotation.x = 0.15;

    head.castShadow = true;
    thorax.castShadow = true;
    gaster.castShadow = true;
    group.add(head);
    group.add(thorax);
    group.add(petiole);
    group.add(gaster);

    // ─────────────────────────────────────────────────────────────
    //  MANDIBLES — curved triangular plates
    // ─────────────────────────────────────────────────────────────
    const mandibleMat = new THREE.MeshStandardMaterial({
      color: 0x4a2800, roughness: 0.25, metalness: 0.3,
    });

    if (isSoldier) {
      // Soldier: massive curved mandibles (>50% of head width)
      const mLen = headW * 1.8;
      const mWid = headW * 0.4;
      const mGeo = new THREE.BoxGeometry(mWid, 0.02 * U, mLen);
      // Taper the front end by scaling vertices
      const mPos = mGeo.getAttribute('position');
      for (let i = 0; i < mPos.count; i++) {
        const z = mPos.getZ(i);
        if (z > 0) { // front half tapers
          const taper = 1 - (z / (mLen / 2)) * 0.7;
          mPos.setX(i, mPos.getX(i) * taper);
        }
      }
      mPos.needsUpdate = true;
      mGeo.computeVertexNormals();

      const m1 = new THREE.Mesh(mGeo, mandibleMat);
      const m2 = new THREE.Mesh(mGeo, mandibleMat);
      const mZ = headZ + headD * 0.6;
      m1.position.set(-headW * 0.35, -headH * 0.3, mZ);
      m1.rotation.y = 0.35;  // splay outward
      m1.rotation.x = 0.1;   // slight downward curve
      m2.position.set(headW * 0.35, -headH * 0.3, mZ);
      m2.rotation.y = -0.35;
      m2.rotation.x = 0.1;
      m1.castShadow = true;
      m2.castShadow = true;
      group.add(m1);
      group.add(m2);
    } else if (!isQueen) {
      // Worker: small paired mandibles
      const mLen = headW * 0.9;
      const mWid = headW * 0.25;
      const mGeo = new THREE.BoxGeometry(mWid, 0.012 * U, mLen);
      const mPos = mGeo.getAttribute('position');
      for (let i = 0; i < mPos.count; i++) {
        const z = mPos.getZ(i);
        if (z > 0) {
          const taper = 1 - (z / (mLen / 2)) * 0.65;
          mPos.setX(i, mPos.getX(i) * taper);
        }
      }
      mPos.needsUpdate = true;
      mGeo.computeVertexNormals();

      const m1 = new THREE.Mesh(mGeo, mandibleMat);
      const m2 = new THREE.Mesh(mGeo, mandibleMat);
      const mZ = headZ + headD * 0.55;
      m1.position.set(-headW * 0.3, -headH * 0.25, mZ);
      m1.rotation.y = 0.3;
      m2.position.set(headW * 0.3, -headH * 0.25, mZ);
      m2.rotation.y = -0.3;
      group.add(m1);
      group.add(m2);
    } else {
      // Queen: small mandibles similar to worker
      const mLen = headW * 0.7;
      const mGeo = new THREE.BoxGeometry(headW * 0.2, 0.01 * U, mLen);
      const m1 = new THREE.Mesh(mGeo, mandibleMat);
      const m2 = new THREE.Mesh(mGeo, mandibleMat);
      const mZ = headZ + headD * 0.5;
      m1.position.set(-headW * 0.25, -headH * 0.2, mZ);
      m1.rotation.y = 0.25;
      m2.position.set(headW * 0.25, -headH * 0.2, mZ);
      m2.rotation.y = -0.25;
      group.add(m1);
      group.add(m2);
    }

    // ─────────────────────────────────────────────────────────────
    //  ANTENNAE — elbowed: scape (base) + funiculus (angled whip)
    // ─────────────────────────────────────────────────────────────
    const scapeLen = 0.12 * U;
    const funLen = 0.15 * U;
    const antR = 0.008 * U;
    const scapeGeo = new THREE.CylinderGeometry(antR, antR * 0.9, scapeLen, 4);
    const funGeo = new THREE.CylinderGeometry(antR * 0.7, antR * 0.5, funLen, 4);

    for (let side = -1; side <= 1; side += 2) {
      // Scape: rises upward and slightly outward from front of head
      const scape = new THREE.Mesh(scapeGeo, darkMat);
      const aX = side * headW * 0.4;
      const aY = headH * 0.6;
      const aZ = headZ + headD * 0.5;
      scape.position.set(aX, aY, aZ);
      scape.rotation.z = side * -0.3;
      scape.rotation.x = -0.6; // angle forward-up

      // Funiculus: bends at elbow, angles forward
      const fun = new THREE.Mesh(funGeo, darkMat);
      fun.position.set(0, scapeLen * 0.45, 0);
      fun.rotation.x = 0.8; // elbow bend
      fun.rotation.z = side * 0.15;
      scape.add(fun);

      group.add(scape);
    }

    // ─────────────────────────────────────────────────────────────
    //  LEGS — 3 pairs, 2 segments each (femur + tibia), jointed
    // ─────────────────────────────────────────────────────────────
    const femurLen = 0.12 * U;
    const tibiaLen = 0.14 * U;
    const legR = 0.008 * U;
    const femurGeo = new THREE.CylinderGeometry(legR, legR * 0.8, femurLen, 4);
    const tibiaGeo = new THREE.CylinderGeometry(legR * 0.7, legR * 0.5, tibiaLen, 4);
    const legMat = darkMat;

    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const pair = i % 3; // 0=front, 1=mid, 2=rear

      // Leg attachment point on thorax
      const legGroup = new THREE.Group();
      const attachZ = thoraxZ + (1 - pair) * thoraxD * 0.55;
      const attachX = side * thoraxW * 0.85;
      const attachY = -thoraxH * 0.4;
      legGroup.position.set(attachX, attachY, attachZ);

      // Femur: angles outward and downward
      const femur = new THREE.Mesh(femurGeo, legMat);
      femur.position.set(side * femurLen * 0.35, -femurLen * 0.2, 0);
      femur.rotation.z = side * 0.8; // splay outward
      // Front legs angle forward, rear legs angle backward
      femur.rotation.x = (pair - 1) * 0.3;

      // Tibia: bends downward from femur tip
      const tibia = new THREE.Mesh(tibiaGeo, legMat);
      tibia.position.set(side * 0.01, -femurLen * 0.45, 0);
      tibia.rotation.z = side * -0.5; // bend inward/downward
      femur.add(tibia);

      legGroup.add(femur);
      group.add(legGroup);
      legs.push(legGroup);
    }

    // ─────────────────────────────────────────────────────────────
    //  FOOD-CARRYING INDICATOR (golden sphere, hidden by default)
    // ─────────────────────────────────────────────────────────────
    const foodGeo = new THREE.SphereGeometry(0.06 * U, 6, 6);
    const foodMat = new THREE.MeshStandardMaterial({
      color: 0xffcc00, emissive: 0x664400, emissiveIntensity: 0.5, roughness: 0.4,
    });
    const foodIndicator = new THREE.Mesh(foodGeo, foodMat);
    // Position between mandibles (ant carries food in front)
    foodIndicator.position.set(0, 0, headZ + headD * 0.8);
    foodIndicator.visible = false;
    group.add(foodIndicator);

    // ─── Store metadata ─────
    group.userData.antType = type;
    group.userData.isQueen = isQueen;
    group.userData.birthTick = performance.now();
    group.userData.originalMaterial = bodyMaterial;

    this.scene.add(group);
    this.antMeshes.set(id, group);
    this.antBodies.set(id, { head, thorax, petiole, gaster, legs, foodIndicator });

    return group;
  }

  /**
   * Update ant mesh position, rotation, and animation.
   * @param {string} id - composite mesh key
   * @param {number} x - grid X
   * @param {number} y - grid Y
   * @param {number} angle - facing angle (radians)
   * @param {number} carryingFood - amount of food carried (0 = none)
   * @param {number} hitFlash - hit flash timer (>0 = flashing)
   * @param {boolean} isMoving - whether the ant is moving (for leg animation)
   */
  updateAntMesh(id, x, y, angle, carryingFood = 0, hitFlash = 0, isMoving = true) {
    const mesh = this.antMeshes.get(id);
    if (!mesh) return;
    
    const worldX = (x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
    const worldZ = (y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
    const terrainY = this.getTerrainHeight(worldX, worldZ);
    mesh.position.set(worldX, terrainY + 0.15, worldZ);
    mesh.rotation.y = Math.PI / 2 - angle;
    
    const bodies = this.antBodies.get(id);
    if (!bodies) return;

    // --- Food-carrying indicator (golden sphere between mandibles) ---
    if (bodies.foodIndicator) {
      bodies.foodIndicator.visible = carryingFood > 0;
      if (carryingFood > 0) {
        // Gentle bob while carried
        bodies.foodIndicator.position.y = Math.sin(performance.now() * 0.005) * 0.015;
      }
    }

    // --- Hit flash (swap to white material) ---
    const mat = hitFlash > 0 ? this.flashMaterial : mesh.userData.originalMaterial;
    if (bodies.head.material !== mat) {
      bodies.head.material = mat;
      bodies.thorax.material = mat;
      if (bodies.petiole) bodies.petiole.material = mat;
      bodies.gaster.material = mat;
    }

    // --- Walking leg animation (tripod gait with jointed legs) ---
    if (isMoving && bodies.legs && !mesh.userData.isQueen) {
      const t = performance.now() * 0.015;
      for (let i = 0; i < bodies.legs.length; i++) {
        const phase = (i % 3) * (Math.PI * 2 / 3);
        const swing = Math.sin(t + phase) * 0.25;
        // Rotate the whole leg group (femur + tibia follow)
        bodies.legs[i].rotation.x += swing * 0.08;
        bodies.legs[i].rotation.z = swing * 0.15;
      }
    }

    // Queen pulsating abdomen animation
    if (mesh.userData.isQueen) {
      if (bodies.gaster) {
        const t = performance.now() * 0.003;
        const pulse = 1.0 + Math.sin(t) * 0.08;
        const U = 1.4; // queen base unit
        const gW = 0.20 * U; const gH = 0.17 * U; const gD = 0.35 * U;
        bodies.gaster.scale.set(gW * pulse, gH * pulse, gD * pulse);
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

  // ─── BLOOM POST-PROCESSING ──────────────────────────────────────────

  setupBloom() {
    const renderPass = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      CONFIG.BLOOM_STRENGTH,   // 0.5
      CONFIG.BLOOM_RADIUS,     // 0.4
      CONFIG.BLOOM_THRESHOLD   // 0.8
    );
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloomPass);
    this.bloomPass = bloomPass;

    // Add particle system to the scene after bloom is ready
    this.scene.add(this.particles);
    console.log('✓ Bloom post-processing enabled');
  }

  // ─── PARTICLE SYSTEM ───────────────────────────────────────────────

  /**
   * Spawn burst of particles at a world position.
   * @param {number} wx - world X
   * @param {number} wy - world Y
   * @param {number} wz - world Z
   * @param {number} count - number of particles
   * @param {{r:number,g:number,b:number}} color - particle color (0-1)
   * @param {number} spread - position jitter
   * @param {number} speed - velocity magnitude
   */
  spawnParticles(wx, wy, wz, count, color, spread, speed) {
    for (let i = 0; i < count; i++) {
      const idx = this.nextParticleIdx % this.MAX_PARTICLES;
      this.nextParticleIdx++;
      const i3 = idx * 3;
      this.particlePositions[i3]     = wx + (Math.random() - 0.5) * spread;
      this.particlePositions[i3 + 1] = wy + Math.random() * spread;
      this.particlePositions[i3 + 2] = wz + (Math.random() - 0.5) * spread;
      this.particleVelocities[i3]     = (Math.random() - 0.5) * speed;
      this.particleVelocities[i3 + 1] = Math.random() * speed * 2;
      this.particleVelocities[i3 + 2] = (Math.random() - 0.5) * speed;
      this.particleLifetimes[idx] = 1.0;
      this.particleColors[i3]     = color.r;
      this.particleColors[i3 + 1] = color.g;
      this.particleColors[i3 + 2] = color.b;
    }
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Update all particles (call once per frame with real dt).
   */
  updateParticles(dt) {
    let anyActive = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      if (this.particleLifetimes[i] <= 0) continue;
      anyActive = true;
      this.particleLifetimes[i] -= dt * 2; // fade over ~0.5s
      const i3 = i * 3;
      this.particlePositions[i3]     += this.particleVelocities[i3] * dt;
      this.particlePositions[i3 + 1] += this.particleVelocities[i3 + 1] * dt - 0.5 * dt; // gravity
      this.particlePositions[i3 + 2] += this.particleVelocities[i3 + 2] * dt;
      if (this.particleLifetimes[i] <= 0) {
        this.particlePositions[i3 + 1] = -999; // hide dead particle
      }
    }
    if (anyActive) {
      this.particles.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ─── DEATH ANIMATION ───────────────────────────────────────────────

  /**
   * Start death animation for an ant mesh.
   */
  startDeathAnimation(id) {
    if (this.antMeshes.has(id) && !this.dyingAnts.has(id)) {
      // Clone materials so fading doesn't affect shared materials
      const mesh = this.antMeshes.get(id);
      mesh.traverse(child => {
        if (child.isMesh && child.material) {
          child.material = child.material.clone();
          child.material.transparent = true;
        }
      });
      this.dyingAnts.set(id, { timer: 0, duration: 30 });
    }
  }

  /**
   * Update all dying ant animations. Call once per frame.
   */
  updateDyingAnts() {
    for (const [key, state] of this.dyingAnts) {
      state.timer++;
      const t = state.timer / state.duration;
      const mesh = this.antMeshes.get(key);
      if (mesh) {
        mesh.scale.setScalar(1 - t * 0.8);          // shrink to 20%
        mesh.rotation.z = t * Math.PI * 0.3;         // topple sideways
        mesh.position.y -= 0.004;                    // sink into ground
        mesh.traverse(child => {
          if (child.isMesh && child.material) {
            child.material.opacity = 1 - t;
          }
        });
      }
      if (t >= 1) {
        this.removeAntMesh(key);
        this.dyingAnts.delete(key);
      }
    }
  }

  // ─── 3D PHEROMONE TRAIL VISUALIZATION ──────────────────────────────

  /**
   * Initialize the instanced mesh for pheromone trail rendering.
   */
  createPheromoneLayer() {
    const sampleStep = 3; // sample every 3 grid cells
    const cellW = Math.ceil(CONFIG.WORLD_WIDTH / sampleStep);
    const cellH = Math.ceil(CONFIG.WORLD_HEIGHT / sampleStep);
    this.pheroSampleStep = sampleStep;
    this.pheroCellW = cellW;
    this.pheroCellH = cellH;

    const quadSize = CONFIG.CELL_SIZE * sampleStep;
    const pheroGeo = new THREE.PlaneGeometry(quadSize, quadSize);
    pheroGeo.rotateX(-Math.PI / 2);
    const pheroMat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1.0,
    });
    const maxInstances = cellW * cellH;
    this.pheromoneInstanced = new THREE.InstancedMesh(pheroGeo, pheroMat, maxInstances);
    this.pheromoneInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance color
    const colors = new Float32Array(maxInstances * 3);
    this.pheromoneInstanced.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.pheromoneInstanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.pheromoneInstanced.frustumCulled = false;
    this.pheromoneInstanced.renderOrder = -1; // render before ants
    this.scene.add(this.pheromoneInstanced);
    this._pheroMatrix = new THREE.Matrix4();
    console.log('✓ Pheromone 3D layer: ' + maxInstances + ' max instances');
  }

  /**
   * Update 3D pheromone visualization from heatmap data.
   * @param {Array} playerGrid - food trail for player colony
   * @param {Array} enemyGrid - food trail for enemy colony
   * @param {Array} playerAlarmGrid - alarm pheromone for player colony
   * @param {Array} enemyAlarmGrid - alarm pheromone for enemy colony
   */
  updatePheromoneLayer(playerGrid, enemyGrid, playerAlarmGrid, enemyAlarmGrid) {
    if (!this.pheromoneInstanced) return;
    const step = this.pheroSampleStep;
    const threshold = 5;
    let idx = 0;

    for (let gx = 0; gx < CONFIG.WORLD_WIDTH; gx += step) {
      for (let gy = 0; gy < CONFIG.WORLD_HEIGHT; gy += step) {
        const pVal = playerGrid[gx] ? (playerGrid[gx][gy] || 0) : 0;
        const eVal = enemyGrid[gx] ? (enemyGrid[gx][gy] || 0) : 0;
        const paVal = playerAlarmGrid ? (playerAlarmGrid[gx] ? (playerAlarmGrid[gx][gy] || 0) : 0) : 0;
        const eaVal = enemyAlarmGrid ? (enemyAlarmGrid[gx] ? (enemyAlarmGrid[gx][gy] || 0) : 0) : 0;
        const alarmVal = paVal + eaVal;

        if (pVal < threshold && eVal < threshold && alarmVal < threshold) continue;

        const worldX = (gx - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
        const worldZ = (gy - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
        const terrainY = this.getTerrainHeight(worldX, worldZ);

        this._pheroMatrix.makeTranslation(worldX, terrainY + 0.02, worldZ);
        this.pheromoneInstanced.setMatrixAt(idx, this._pheroMatrix);

        // Color: green for player food, red for enemy food, orange for alarm
        const pA = Math.min(1, pVal / 150);
        const eA = Math.min(1, eVal / 150);
        const aA = Math.min(1, alarmVal / 100);
        const r = Math.min(1, eA * 0.85 + aA * 1.0);
        const g = Math.min(1, pA * 0.75 + aA * 0.5);
        const b = 0;
        this.pheromoneInstanced.instanceColor.setXYZ(idx, r, g, b);
        idx++;
      }
    }

    this.pheromoneInstanced.count = idx;
    this.pheromoneInstanced.instanceMatrix.needsUpdate = true;
    this.pheromoneInstanced.instanceColor.needsUpdate = true;
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
