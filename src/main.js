import * as THREE from 'three';
import CONFIG from './sim/config.js';
import { SimulationEngine } from './sim/index.js';
import { SceneManager } from './render/scene.js';
import { PlayerController } from './render/player.js';
import { UndergroundRenderer } from './render/underground.js';

console.log('🚀 AntenbOro modules loaded');
const statusEl = document.getElementById('status');
function updateStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

/**
 * Main game application.
 */
class AntenbOro {
  constructor() {
    try {
      updateStatus('Creating simulation...');
      this.simulation = new SimulationEngine();
      
      // Rendering
      const canvas = document.getElementById('canvas');
      if (!canvas) throw new Error('Canvas element not found');
      updateStatus('Creating scene...');
      this.sceneManager = new SceneManager(canvas);
      
      // Player
      updateStatus('Creating player...');
      this.playerController = new PlayerController(
        this.simulation.playerColony,
        this.simulation,
        this.sceneManager
      );
      
      // UI
      this.uiManager = new UIManager(this.simulation, this.playerController);
      
      // Fixed-timestep accumulator
      this.accumulator = 0;
      this.deltaTime = 1 / CONFIG.TICKS_PER_SECOND;
      this.lastFrameTime = performance.now();
      
      // Initialize world visuals
      updateStatus('Building world...');
      this.sceneManager.createTerrain();
      this.sceneManager.createNestMeshes();
      this.sceneManager.createFoodMeshes(this.simulation.world.foodPatches);
      this.sceneManager.snapWorldObjectsToTerrain();
      this.sceneManager.applyNestMoundsToTerrain();
      this.sceneManager.setupBloom();
      this.sceneManager.createPheromoneLayer();
      this._syncAntMeshes();

      // Underground renderer (uses same WebGL renderer + camera)
      updateStatus('Building underground...');
      this.undergroundRenderer = new UndergroundRenderer(
        this.sceneManager.renderer,
        this.sceneManager.camera
      );
      // Build initial underground geometry for player colony
      this.undergroundRenderer.rebuild(this.simulation.playerColony.underground);

      // Create queen mesh in underground scene
      this._setupUndergroundQueen();

      // Track previous hitFlash state for particle triggers
      this._prevHitFlash = new Map();
      // Track previous queen laying state for egg-burst particles
      this._prevQueenLaying = new Map();
      
      // Start game loop
      this._setupGameLoop();
      console.log('🎮 Game initialized — ' + this.sceneManager.antMeshes.size + ' ants');
    } catch (err) {
      console.error('❌ INIT ERROR:', err.message, err.stack);
      updateStatus('❌ ERROR: ' + err.message);
      throw err;
    }
  }

  _syncAntMeshes() {
    // Create initial meshes for all ants
    const allAnts = [
      ...this.simulation.playerColony.ants,
      ...this.simulation.enemyColony.ants,
    ];

    for (const ant of allAnts) {
      // Skip player colony queen — she lives underground
      if (ant.type === 'QUEEN' && ant.colonyId === 0) continue;
      const meshKey = `${ant.colonyId}_${ant.id}`;
      if (!this.sceneManager.antMeshes.has(meshKey)) {
        this.sceneManager.createAntMesh(meshKey, ant.type, ant.colonyId);
      }
    }
  }

  /**
   * Create the queen ant mesh in the underground scene.
   * The queen lives underground in her chamber.
   */
  _setupUndergroundQueen() {
    const queen = this.simulation.playerColony.queen;
    if (!queen) return;

    const meshKey = `ug_queen_${queen.colonyId}`;
    // Use the surface scene's createAntMesh to make the mesh, then move it to underground
    this.sceneManager.createAntMesh(meshKey, 'QUEEN', queen.colonyId);
    const queenMesh = this.sceneManager.antMeshes.get(meshKey);
    if (queenMesh) {
      // Reparent: remove from surface scene, add to underground scene
      this.sceneManager.scene.remove(queenMesh);
      this.undergroundRenderer.scene.add(queenMesh);
      this._ugQueenMesh = queenMesh;
      this._ugQueenKey = meshKey;

      // Position queen in her chamber
      const chamber = this.simulation.playerColony.underground.getQueenChamber();
      if (chamber) {
        queenMesh.position.set(chamber.x, chamber.y - chamber.radius * 0.4 + 0.15, chamber.z);
      }
    }
  }

  /**
   * Update underground queen position and animation each frame.
   */
  _updateUndergroundQueen() {
    if (!this._ugQueenMesh) return;
    const queen = this.simulation.playerColony.queen;
    if (!queen || queen.isDead) return;

    const chamber = this.simulation.playerColony.underground.getQueenChamber();
    if (!chamber) return;

    // Queen wanders gently inside chamber (convert grid-space offset to local underground)
    const offsetX = (queen.x - this.simulation.playerColony.nestX) * CONFIG.CELL_SIZE * 0.3;
    const offsetZ = (queen.y - this.simulation.playerColony.nestY) * CONFIG.CELL_SIZE * 0.3;

    const floorY = chamber.y - chamber.radius * 0.4 + 0.15;
    this._ugQueenMesh.position.set(
      chamber.x + offsetX,
      floorY,
      chamber.z + offsetZ
    );
    this._ugQueenMesh.rotation.y = Math.PI / 2 - queen.angle;

    // Update queen laying animation on mesh userData
    this._ugQueenMesh.userData.isLayingEgg = queen.isLayingEgg;

    // Update queen body animation (gaster pulse / laying contraction)
    const bodies = this.sceneManager.antBodies.get(this._ugQueenKey);
    if (bodies && bodies.gaster) {
      const U = 1.4;
      const gW = 0.20 * U, gH = 0.17 * U, gD = 0.35 * U;
      const laying = queen.isLayingEgg || 0;
      if (laying > 0) {
        const progress = 1.0 - (laying / 20);
        const squeeze = 1.0 - Math.sin(progress * Math.PI) * 0.25;
        bodies.gaster.scale.set(gW * squeeze * 1.1, gH * squeeze, gD * (1.0 + progress * 0.15));
      } else {
        const t = performance.now() * 0.003;
        const pulse = 1.0 + Math.sin(t) * 0.08;
        bodies.gaster.scale.set(gW * pulse, gH * pulse, gD * pulse);
      }
    }
  }

  _setupGameLoop() {
    const gameLoop = (currentTime) => {
      const deltaMs = currentTime - this.lastFrameTime;
      this.lastFrameTime = currentTime;
      const delta = Math.min(deltaMs / 1000, 0.05); // Clamp to 50ms max
      
      // Accumulate time
      const speedMultiplier = this.playerController.isFPSMode ? 1 : this.simulation.getSpeedMultiplier();
      this.accumulator += delta * speedMultiplier;
      
      // Run fixed-timestep simulation updates
      while (this.accumulator >= this.deltaTime) {
        this.simulation.updateTick();
        this.accumulator -= this.deltaTime;
      }
      
      // Update player input
      this.playerController.update();
      
      // Sync all ant meshes to simulation state
      this._updateAntMeshes();
      
      // Sync egg visuals with colonies
      this._updateEggMeshes();
      
      // Update underground queen mesh
      this._updateUndergroundQueen();

      // Update death animations
      this.sceneManager.updateDyingAnts();

      // Update particles
      const realDt = deltaMs / 1000;
      this.sceneManager.updateParticles(realDt);

      // Update 3D pheromone trails (food + alarm)
      const playerGrid = this.simulation.world.pheromones.getHeatmap(0);
      const enemyGrid = this.simulation.world.pheromones.getHeatmap(1);
      const playerAlarmGrid = this.simulation.world.pheromones.getHeatmap(2);
      const enemyAlarmGrid = this.simulation.world.pheromones.getHeatmap(3);
      this.sceneManager.updatePheromoneLayer(playerGrid, enemyGrid, playerAlarmGrid, enemyAlarmGrid);
      
      // Update food visuals
      this.sceneManager.updateFoodMeshes(this.simulation.world.foodPatches);
      
      // Update camera
      this.playerController.updateCamera(this.sceneManager.camera);
      
      // Update UI
      this.uiManager.update();
      
      // Render — swap scene based on underground state
      if (this.playerController.isUnderground) {
        this.undergroundRenderer.render(this.sceneManager.camera);
      } else {
        this.sceneManager.render();
      }
      
      requestAnimationFrame(gameLoop);
    };
    
    requestAnimationFrame(gameLoop);
  }

  _updateAntMeshes() {
    const allAnts = [
      ...this.simulation.playerColony.ants,
      ...this.simulation.enemyColony.ants,
    ];

    // Update existing ant meshes
    for (const ant of allAnts) {
      // Skip player colony queen — she lives underground
      if (ant.type === 'QUEEN' && ant.colonyId === 0) continue;
      const meshKey = `${ant.colonyId}_${ant.id}`;
      if (!ant.isDead) {
        // Queen moves slowly inside nest; detect if actually moving
        const isMoving = ant.type === 'QUEEN'
          ? (ant.isLayingEgg <= 0) // queen moves unless laying
          : (ant.state !== 'GUARDING' || ant.isPlayerControlled);
        this.sceneManager.updateAntMesh(
          meshKey, ant.x, ant.y, ant.angle,
          ant.carryingFood, ant.hitFlash, isMoving
        );
        
        // Ensure mesh exists
        if (!this.sceneManager.antMeshes.has(meshKey)) {
          this.sceneManager.createAntMesh(meshKey, ant.type, ant.colonyId);
        }

        // Pass queen laying state to mesh for animation
        if (ant.type === 'QUEEN') {
          const mesh = this.sceneManager.antMeshes.get(meshKey);
          if (mesh) mesh.userData.isLayingEgg = ant.isLayingEgg;
          
          // Spawn particles when queen starts laying (fresh transition)
          const prevLaying = this._prevQueenLaying.get(meshKey) || 0;
          if (ant.isLayingEgg > 0 && prevLaying === 0) {
            // Cream-colored puff behind queen's abdomen
            const wx = (ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
            const wz = (ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
            const wy = this.sceneManager.getTerrainHeight(wx, wz) + 0.1;
            this.sceneManager.spawnParticles(wx, wy, wz, 8, {r:1, g:0.95, b:0.8}, 0.1, 0.2);
          }
          this._prevQueenLaying.set(meshKey, ant.isLayingEgg);
        }

        // Spawn bite-spark particles on fresh hit
        const prevFlash = this._prevHitFlash.get(meshKey) || 0;
        if (ant.hitFlash > 0 && prevFlash === 0) {
          const wx = (ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
          const wz = (ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
          const wy = this.sceneManager.getTerrainHeight(wx, wz) + 0.2;
          this.sceneManager.spawnParticles(wx, wy, wz, 6, {r:1, g:0.6, b:0.1}, 0.15, 0.5);
        }
        this._prevHitFlash.set(meshKey, ant.hitFlash);
      } else {
        // Start death animation instead of instant removal
        if (this.sceneManager.antMeshes.has(meshKey) && !this.sceneManager.dyingAnts.has(meshKey)) {
          this.sceneManager.startDeathAnimation(meshKey);
          this._prevHitFlash.delete(meshKey);
        }
      }
    }
  }

  /**
   * Sync brood meshes (eggs, larvae, pupae) with both colonies.
   * Each brood item gets a unique key, position, and lifecycle stage.
   * Player colony brood lives underground; enemy colony brood is on surface.
   */
  _updateEggMeshes() {
    const surfaceBrood = [];
    const ugBrood = [];

    for (const colony of [this.simulation.playerColony, this.simulation.enemyColony]) {
      const isPlayer = colony.id === 0;
      const list = isPlayer ? ugBrood : surfaceBrood;

      // Eggs
      for (const egg of colony.eggQueue) {
        list.push({
          key: `egg_${colony.id}_${egg.id}`,
          x: egg.x, y: egg.y,
          age: egg.age,
          stage: 'egg',
        });
      }
      // Larvae
      for (const larva of colony.larvaQueue) {
        list.push({
          key: `larva_${colony.id}_${larva.id}`,
          x: larva.x, y: larva.y,
          age: larva.age,
          stage: 'larva',
        });
      }
      // Pupae
      for (const pupa of colony.pupaQueue) {
        list.push({
          key: `pupa_${colony.id}_${pupa.id}`,
          x: pupa.x, y: pupa.y,
          age: pupa.age,
          stage: 'pupa',
        });
      }
    }

    // Surface brood (enemy colony) — render in surface scene
    this.sceneManager.updateBrood(surfaceBrood);

    // Underground brood (player colony) — position in queen chamber
    this._updateUndergroundBrood(ugBrood);
  }

  /**
   * Render player colony brood (eggs/larvae/pupae) inside the
   * underground queen chamber scene.
   */
  _updateUndergroundBrood(broodItems) {
    const ugScene = this.undergroundRenderer.scene;
    const chamber = this.simulation.playerColony.underground.getQueenChamber();
    if (!chamber) return;

    if (!this._ugBroodMeshes) this._ugBroodMeshes = new Map();

    const activeKeys = new Set();
    for (const item of broodItems) {
      activeKeys.add(item.key);

      // Create mesh if needed
      if (!this._ugBroodMeshes.has(item.key)) {
        const mesh = this._createUgBroodMesh(item.stage);
        // Scatter around queen chamber floor
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * chamber.radius * 0.5;
        const bx = chamber.x + Math.cos(angle) * dist;
        const bz = chamber.z + Math.sin(angle) * dist;
        const by = chamber.y - chamber.radius * 0.4 + 0.03;
        mesh.position.set(bx, by, bz);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        mesh.userData.baseY = by;
        ugScene.add(mesh);
        this._ugBroodMeshes.set(item.key, mesh);
      }

      // Animate
      const mesh = this._ugBroodMeshes.get(item.key);
      if (!mesh) continue;

      if (item.stage === 'egg') {
        const grow = Math.min(1.0, item.age / 30);
        const s = 0.5 + grow * 0.5;
        mesh.scale.set(s, s, s);
        const wobble = Math.sin(performance.now() * 0.002 + item.age * 0.1) * 0.005;
        mesh.position.y = mesh.userData.baseY + wobble;
      } else if (item.stage === 'larva') {
        const squirm = Math.sin(performance.now() * 0.004 + item.age * 0.05) * 0.08;
        mesh.rotation.z = squirm;
        const breathe = 1.0 + Math.sin(performance.now() * 0.003) * 0.05;
        mesh.scale.set(1, breathe, 1);
      } else if (item.stage === 'pupa') {
        const pulse = 1.0 + Math.sin(performance.now() * 0.001) * 0.02;
        mesh.scale.set(pulse, pulse, pulse);
      }
    }

    // Remove gone brood
    for (const [key, mesh] of this._ugBroodMeshes) {
      if (!activeKeys.has(key)) {
        ugScene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        this._ugBroodMeshes.delete(key);
      }
    }
  }

  /**
   * Create a small brood mesh for the underground scene.
   */
  _createUgBroodMesh(stage) {
    if (stage === 'egg') {
      const geo = new THREE.SphereGeometry(0.04, 8, 6);
      geo.scale(1.0, 0.75, 1.4);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf5f0e8, emissive: 0x443322, emissiveIntensity: 0.3,
        roughness: 0.25,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(0.5, 0.5, 0.5);
      return mesh;
    } else if (stage === 'larva') {
      const group = new THREE.Group();
      const segGeo = new THREE.SphereGeometry(0.04, 6, 5);
      const segMat = new THREE.MeshStandardMaterial({
        color: 0xfaf0dc, emissive: 0x332200, emissiveIntensity: 0.15,
        roughness: 0.4, transparent: true, opacity: 0.85,
      });
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(segGeo, segMat);
        const t = (i - 1) * 0.06;
        seg.position.set(0, Math.abs(t) * 0.3, t);
        seg.scale.set(0.8 + (1 - Math.abs(i - 1)) * 0.3, 0.7, 1.0);
        group.add(seg);
      }
      const headGeo = new THREE.SphereGeometry(0.015, 4, 4);
      const headMat = new THREE.MeshStandardMaterial({ color: 0x443322, roughness: 0.6 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 0.01, 0.09);
      group.add(head);
      return group;
    } else { // pupa
      const geo = new THREE.CapsuleGeometry(0.035, 0.07, 4, 8);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc8a050, emissive: 0x331800, emissiveIntensity: 0.2,
        roughness: 0.35, metalness: 0.05,
      });
      return new THREE.Mesh(geo, mat);
    }
  }
}

/**
 * Simple UI manager for HUD display.
 */
class UIManager {
  constructor(simulation, playerController) {
    this.simulation = simulation;
    this.playerController = playerController;
    
    this.hud = document.getElementById('hud');
    this.minimapCanvas = document.getElementById('minimap');
    this.strategyCanvas = document.getElementById('strategyCanvas');
    
    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }
    
    // Strategy canvas (full-screen 2D overhead)
    if (this.strategyCanvas) {
      this.strategyCtx = this.strategyCanvas.getContext('2d');
      this._resizeStrategyCanvas();
      window.addEventListener('resize', () => this._resizeStrategyCanvas());
    }
    
    // Pan/zoom for strategy view
    this.stratPanX = CONFIG.WORLD_WIDTH / 2;
    this.stratPanY = CONFIG.WORLD_HEIGHT / 2;
    this.stratZoom = 1.0; // 1.0 = fit whole world
  }

  _resizeStrategyCanvas() {
    if (!this.strategyCanvas) return;
    this.strategyCanvas.width = window.innerWidth;
    this.strategyCanvas.height = window.innerHeight;
  }

  update() {
    const isOverhead = !this.playerController.isFPSMode && !this.playerController.isUnderground;
    
    // Toggle strategy canvas visibility
    if (this.strategyCanvas) {
      this.strategyCanvas.style.display = isOverhead ? 'block' : 'none';
    }
    
    // Update HUD text
    const playerStats = this.simulation.getPlayerStats();
    const enemyStats = this.simulation.getEnemyStats();
    
    let hudText = `
      <div class="hud-section">
        <h3>Player Colony</h3>
        <p>Food: ${playerStats.food}</p>
        <p>Ants: ${playerStats.totalAnts} (W:${playerStats.workers} S:${playerStats.soldiers})</p>
        <p>Queen HP: ${playerStats.queenHealth}/${playerStats.queenMaxHealth}</p>
      </div>
      <div class="hud-section">
        <h3>Enemy Colony</h3>
        <p>Food: ${enemyStats.food}</p>
        <p>Ants: ${enemyStats.totalAnts} (W:${enemyStats.workers} S:${enemyStats.soldiers})</p>
        <p>Queen HP: ${enemyStats.queenHealth}/${enemyStats.queenMaxHealth}</p>
      </div>
      <div class="hud-section">
        <p>Mode: ${this.playerController.isUnderground ? '🕳️ UNDERGROUND (Press E at entrance to exit)' : this.playerController.isFPSMode ? 'FPS (Press TAB for Overhead, E at nest to enter)' : 'OVERHEAD (Press TAB for FPS)'}</p>
        <p>Speed: ${this.simulation.getSpeedMultiplier()}x</p>
        <p>Tick: ${this.simulation.tick}</p>
      </div>
    `;
    
    if (this.simulation.gameOver) {
      hudText += `<div class="game-over"><h1>${this.simulation.victoryState === 'WON' ? 'VICTORY!' : 'DEFEAT!'}</h1></div>`;
    }
    
    if (this.hud) {
      this.hud.innerHTML = hudText;
    }
    
    // Update minimap
    if (this.minimapCtx) {
      this._updateMinimap();
    }
    
    // Update full-screen strategy view when in overhead mode
    if (isOverhead && this.strategyCtx) {
      this._updateStrategyView();
    }
  }

  _updateMinimap() {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const ctx = this.minimapCtx;
    
    const scaleX = w / CONFIG.WORLD_WIDTH;
    const scaleY = h / CONFIG.WORLD_HEIGHT;
    
    // --- Background: dark earthy green ---
    ctx.fillStyle = '#0d1a0d';
    ctx.fillRect(0, 0, w, h);
    
    // --- Draw pheromone trails ---
    // Player colony pheromones (green glow)
    const playerGrid = this.simulation.world.pheromones.getHeatmap(0);
    const enemyGrid = this.simulation.world.pheromones.getHeatmap(1);
    
    // Sample every 2 cells for performance
    for (let gx = 0; gx < CONFIG.WORLD_WIDTH; gx += 2) {
      for (let gy = 0; gy < CONFIG.WORLD_HEIGHT; gy += 2) {
        const pVal = playerGrid[gx][gy];
        const eVal = enemyGrid[gx][gy];
        
        if (pVal > 3) {
          const alpha = Math.min(0.7, pVal / 150);
          ctx.fillStyle = `rgba(0, 200, 80, ${alpha})`;
          ctx.fillRect(gx * scaleX, gy * scaleY, scaleX * 2, scaleY * 2);
        }
        if (eVal > 3) {
          const alpha = Math.min(0.7, eVal / 150);
          ctx.fillStyle = `rgba(200, 50, 30, ${alpha})`;
          ctx.fillRect(gx * scaleX, gy * scaleY, scaleX * 2, scaleY * 2);
        }
      }
    }
    
    // --- Draw food patches ---
    ctx.fillStyle = '#ffcc00';
    for (const food of this.simulation.world.foodPatches) {
      if (food.amount > 0) {
        const size = Math.max(3, Math.ceil((food.amount / CONFIG.FOOD_PER_CLUSTER) * 6));
        ctx.fillRect(food.x * scaleX - size / 2, food.y * scaleY - size / 2, size, size);
      }
    }
    
    // --- Draw nest locations ---
    // Player nest
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      CONFIG.PLAYER_COLONY_NEST_X * scaleX,
      CONFIG.PLAYER_COLONY_NEST_Y * scaleY,
      CONFIG.NEST_RADIUS * scaleX, 0, Math.PI * 2
    );
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 255, 100, 0.15)';
    ctx.fill();
    
    // Enemy nest
    ctx.strokeStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(
      CONFIG.ENEMY_COLONY_NEST_X * scaleX,
      CONFIG.ENEMY_COLONY_NEST_Y * scaleY,
      CONFIG.NEST_RADIUS * scaleX, 0, Math.PI * 2
    );
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
    ctx.fill();
    ctx.lineWidth = 1;
    
    // --- Draw ants ---
    // Player ants (green dots)
    ctx.fillStyle = '#33ff33';
    for (const ant of this.simulation.playerColony.ants) {
      if (!ant.isDead) {
        if (ant.isPlayerControlled) {
          // Hero ant — bright cyan, larger
          ctx.fillStyle = '#00ffff';
          ctx.beginPath();
          ctx.arc(ant.x * scaleX, ant.y * scaleY, 4, 0, Math.PI * 2);
          ctx.fill();
          // Direction indicator
          ctx.strokeStyle = '#00ffff';
          ctx.beginPath();
          ctx.moveTo(ant.x * scaleX, ant.y * scaleY);
          ctx.lineTo(
            (ant.x + Math.cos(ant.angle) * 3) * scaleX,
            (ant.y + Math.sin(ant.angle) * 3) * scaleY
          );
          ctx.stroke();
          ctx.fillStyle = '#33ff33';
        } else {
          ctx.fillRect(ant.x * scaleX - 1, ant.y * scaleY - 1, 2, 2);
        }
      }
    }
    
    // Enemy ants (red dots)
    ctx.fillStyle = '#ff3322';
    for (const ant of this.simulation.enemyColony.ants) {
      if (!ant.isDead) {
        ctx.fillRect(ant.x * scaleX - 1, ant.y * scaleY - 1, 2, 2);
      }
    }
    
    // --- Border ---
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
  }

  /**
   * Full-screen 2D strategy view — like a zoomed-in, pannable minimap.
   * Shows pheromone trails, ants, food, nests — all rendered as 2D.
   */
  _updateStrategyView() {
    const canvas = this.strategyCanvas;
    const ctx = this.strategyCtx;
    const cw = canvas.width;
    const ch = canvas.height;
    
    // Pan state from the player controller — center on hero ant
    const pc = this.playerController;
    const panCenterX = pc.ant.x;
    const panCenterY = pc.ant.y;
    
    // Calculate visible grid area — show ~40 cells wide, proportional height
    const viewCells = 120; // grid cells visible across screen width
    const cellPx = cw / viewCells;
    const viewCellsY = ch / cellPx;
    
    const gridLeft = panCenterX - viewCells / 2;
    const gridTop = panCenterY - viewCellsY / 2;
    
    // Helper: grid to screen
    const gx2sx = (gx) => (gx - gridLeft) * cellPx;
    const gy2sy = (gy) => (gy - gridTop) * cellPx;
    
    // --- Background: earthy dark green ---
    ctx.fillStyle = '#0d1a0d';
    ctx.fillRect(0, 0, cw, ch);
    
    // --- Draw pheromone trails ---
    const playerGrid = this.simulation.world.pheromones.getHeatmap(0);
    const enemyGrid = this.simulation.world.pheromones.getHeatmap(1);
    const playerAlarmGrid = this.simulation.world.pheromones.getHeatmap(2);
    const enemyAlarmGrid = this.simulation.world.pheromones.getHeatmap(3);
    
    const startGX = Math.max(0, Math.floor(gridLeft));
    const endGX = Math.min(CONFIG.WORLD_WIDTH - 1, Math.ceil(gridLeft + viewCells));
    const startGY = Math.max(0, Math.floor(gridTop));
    const endGY = Math.min(CONFIG.WORLD_HEIGHT - 1, Math.ceil(gridTop + viewCellsY));
    
    for (let gx = startGX; gx <= endGX; gx++) {
      for (let gy = startGY; gy <= endGY; gy++) {
        const pVal = playerGrid[gx] ? playerGrid[gx][gy] : 0;
        const eVal = enemyGrid[gx] ? enemyGrid[gx][gy] : 0;
        const paVal = playerAlarmGrid[gx] ? playerAlarmGrid[gx][gy] : 0;
        const eaVal = enemyAlarmGrid[gx] ? enemyAlarmGrid[gx][gy] : 0;
        
        if (pVal > 3) {
          const alpha = Math.min(0.75, pVal / 120);
          ctx.fillStyle = `rgba(0, 200, 80, ${alpha})`;
          ctx.fillRect(gx2sx(gx), gy2sy(gy), cellPx + 1, cellPx + 1);
        }
        if (eVal > 3) {
          const alpha = Math.min(0.75, eVal / 120);
          ctx.fillStyle = `rgba(220, 50, 30, ${alpha})`;
          ctx.fillRect(gx2sx(gx), gy2sy(gy), cellPx + 1, cellPx + 1);
        }
        // Alarm pheromone: bright yellow/orange pulsing
        const alarmVal = paVal + eaVal;
        if (alarmVal > 5) {
          const pulse = 0.6 + Math.sin(performance.now() * 0.008) * 0.4;
          const alpha = Math.min(0.9, (alarmVal / 100)) * pulse;
          ctx.fillStyle = `rgba(255, 160, 0, ${alpha})`;
          ctx.fillRect(gx2sx(gx), gy2sy(gy), cellPx + 1, cellPx + 1);
        }
      }
    }
    
    // --- Draw food patches ---
    for (const food of this.simulation.world.foodPatches) {
      if (food.amount > 0) {
        const sx = gx2sx(food.x);
        const sy = gy2sy(food.y);
        const size = Math.max(4, Math.ceil((food.amount / CONFIG.FOOD_PER_CLUSTER) * cellPx * 1.5));
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
        ctx.fill();
        // Glow
        ctx.fillStyle = 'rgba(255, 204, 0, 0.2)';
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // --- Draw nests ---
    // Player nest (green)
    const pnsx = gx2sx(CONFIG.PLAYER_COLONY_NEST_X);
    const pnsy = gy2sy(CONFIG.PLAYER_COLONY_NEST_Y);
    const nestR = CONFIG.NEST_RADIUS * cellPx;
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pnsx, pnsy, nestR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 255, 100, 0.12)';
    ctx.fill();
    
    // Enemy nest (red)
    const ensx = gx2sx(CONFIG.ENEMY_COLONY_NEST_X);
    const ensy = gy2sy(CONFIG.ENEMY_COLONY_NEST_Y);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ensx, ensy, nestR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1;
    
    // --- Draw ants ---
    const antRadius = Math.max(3, cellPx * 0.35);
    
    // Player ants (green)
    for (const ant of this.simulation.playerColony.ants) {
      if (ant.isDead) continue;
      const sx = gx2sx(ant.x);
      const sy = gy2sy(ant.y);
      // Skip if off-screen
      if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
      
      if (ant.isPlayerControlled) {
        // Hero ant — bright cyan, larger
        ctx.fillStyle = '#00ffff';
        ctx.beginPath();
        ctx.arc(sx, sy, antRadius * 2, 0, Math.PI * 2);
        ctx.fill();
        // Direction indicator
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(
          sx + Math.cos(ant.angle) * antRadius * 5,
          sy + Math.sin(ant.angle) * antRadius * 5
        );
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        // Regular player ant — green dot
        ctx.fillStyle = ant.type === 'SOLDIER' ? '#44ff44' : '#22cc22';
        if (ant.type === 'QUEEN') ctx.fillStyle = '#88ffaa';
        ctx.beginPath();
        ctx.arc(sx, sy, ant.type === 'SOLDIER' ? antRadius * 1.3 : antRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Direction line
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(
          sx + Math.cos(ant.angle) * antRadius * 2.5,
          sy + Math.sin(ant.angle) * antRadius * 2.5
        );
        ctx.stroke();
      }
    }
    
    // Enemy ants (red)
    for (const ant of this.simulation.enemyColony.ants) {
      if (ant.isDead) continue;
      const sx = gx2sx(ant.x);
      const sy = gy2sy(ant.y);
      if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
      
      ctx.fillStyle = ant.type === 'SOLDIER' ? '#ff4444' : '#ff2222';
      if (ant.type === 'QUEEN') ctx.fillStyle = '#ff8888';
      ctx.beginPath();
      ctx.arc(sx, sy, ant.type === 'SOLDIER' ? antRadius * 1.3 : antRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // Direction line
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(
        sx + Math.cos(ant.angle) * antRadius * 2.5,
        sy + Math.sin(ant.angle) * antRadius * 2.5
      );
      ctx.stroke();
    }
    
    // --- Grid border (show world boundaries) ---
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(gx2sx(0), gy2sy(0), CONFIG.WORLD_WIDTH * cellPx, CONFIG.WORLD_HEIGHT * cellPx);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    window.game = new AntenbOro();
    // Hide loading screen
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
    }, 1500);
  } catch (err) {
    console.error('Fatal:', err);
    const s = document.getElementById('status');
    if (s) s.innerHTML = `<span style="color:#f00">❌ ${err.message}</span>`;
  }
});

export { AntenbOro };
