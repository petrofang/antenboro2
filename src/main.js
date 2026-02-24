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
      this._syncAntMeshes();
      
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
      if (!this.sceneManager.antMeshes.has(ant.id)) {
        this.sceneManager.createAntMesh(ant.id, ant.type, ant.colonyId);
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
      if (!ant.isDead) {
        const worldX = (ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
        const worldZ = (ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
        this.sceneManager.updateAntMesh(ant.id, ant.x, ant.y, ant.angle, 0);
        
        // Ensure mesh exists
        if (!this.sceneManager.antMeshes.has(ant.id)) {
          this.sceneManager.createAntMesh(ant.id, ant.type, ant.colonyId);
        }
      } else {
        // Remove dead ant meshes
        this.sceneManager.removeAntMesh(ant.id);
      }
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
    
    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }
  }

  update() {
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
