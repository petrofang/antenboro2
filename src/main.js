import * as THREE from 'three';
import CONFIG from './sim/config.js';
import { SimulationEngine } from './sim/index.js';
import { SceneManager } from './render/scene.js';
import { PlayerController } from './render/player.js';

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
      this.sceneManager.setupBloom();
      this.sceneManager.createPheromoneLayer();
      this._syncAntMeshes();

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
      const meshKey = `${ant.colonyId}_${ant.id}`;
      if (!this.sceneManager.antMeshes.has(meshKey)) {
        this.sceneManager.createAntMesh(meshKey, ant.type, ant.colonyId);
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
      
      // Render
      this.sceneManager.render();
      
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
   * Sync egg meshes with both colonies' egg queues.
   * Each egg gets a unique key and a world position where it was laid.
   */
  _updateEggMeshes() {
    const eggs = [];
    for (const colony of [this.simulation.playerColony, this.simulation.enemyColony]) {
      for (let i = 0; i < colony.eggQueue.length; i++) {
        const egg = colony.eggQueue[i];
        eggs.push({
          key: `egg_${colony.id}_${egg.id}`,
          x: egg.x,
          y: egg.y,
          age: egg.age,
          type: egg.type,
        });
      }
    }
    this.sceneManager.updateEggs(eggs);
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
    const isOverhead = !this.playerController.isFPSMode;
    
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
        <p>Mode: ${this.playerController.isFPSMode ? 'FPS (Press TAB for Overhead)' : 'OVERHEAD (Press TAB for FPS)'}</p>
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
