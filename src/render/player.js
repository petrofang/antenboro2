import * as THREE from 'three';
import CONFIG from '../sim/config.js';
import { Ant } from '../sim/ant.js';

/**
 * Player input handling and hero ant behavior.
 * FPS controls: mouse look via Pointer Lock, WASD relative to camera yaw.
 * Hold Ctrl to release pointer for UI interaction.
 */
export class PlayerController {
  constructor(colony, simulation, sceneManager) {
    this.colony = colony;
    this.simulation = simulation;
    this.sceneManager = sceneManager;
    
    // Create player ant (starts as worker)
    this.ant = new Ant(
      99999,
      'WORKER',
      0,
      CONFIG.PLAYER_COLONY_NEST_X,
      CONFIG.PLAYER_COLONY_NEST_Y
    );
    this.ant.isPlayerControlled = true;
    colony.ants.push(this.ant);
    simulation.setPlayerAnt(this.ant);
    
    // Input state
    this.keys = {};
    this.mouseDown = false;
    
    // FPS camera angles (radians)
    this.yaw = 0;          // Horizontal rotation (left/right)
    this.pitch = 0;         // Vertical rotation (up/down), clamped
    this.mouseSensitivity = 0.002;
    
    // Turn rate for A/D keys (radians per tick)
    this.turnRate = 0.04;
    // Strafe fraction for A/D (fraction of full speed for sideways component)
    this.strafeFraction = 0.3;
    
    // Pointer lock state
    this.pointerLocked = false;
    this.ctrlHeld = false;  // When Ctrl is held, pointer is released for UI
    
    // Ability cooldowns
    this.biteCooldown = 0;
    this.rallyCooldown = 0;
    
    // Camera mode
    this.isFPSMode = true; // true = FPS, false = overhead
    
    // Overhead camera pan
    this.overheadX = 0;
    this.overheadZ = 0;
    
    this._setupInputHandlers();
  }

  _setupInputHandlers() {
    const canvas = this.sceneManager.canvas;
    
    // --- Pointer Lock ---
    canvas.addEventListener('click', () => {
      if (this.isFPSMode && !this.pointerLocked && !this.ctrlHeld) {
        canvas.requestPointerLock();
      }
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    
    // --- Mouse movement (look) ---
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.isFPSMode) return;
      
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch -= e.movementY * this.mouseSensitivity;
      
      // Clamp pitch to avoid flipping
      const maxPitch = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });
    
    // --- Mouse buttons ---
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        if (this.pointerLocked && this.isFPSMode) {
          this._bite();
        }
      }
    });
    
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    });
    
    // --- Keyboard ---
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;
      
      // Track Ctrl for pointer release
      if (e.key === 'Control') {
        this.ctrlHeld = true;
        if (this.pointerLocked) {
          document.exitPointerLock();
        }
      }
      
      // Special keys
      switch (key) {
        case 'tab':
          e.preventDefault();
          this.toggleCameraMode();
          break;
        case 'f':
          this._pickupFood();
          break;
        case 'e':
          this._depositFood();
          break;
        case 'q':
          this._rallyPheromone();
          break;
        case 'b':
          this._openBuildMenu();
          break;
        case 'p':
          this.simulation.togglePause();
          break;
        case 'arrowup':
        case 'arrowright':
          if (!this.isFPSMode) {
            e.preventDefault();
            this.simulation.nextSpeed();
          }
          break;
        case 'escape':
          // Pointer lock auto-releases on Escape; no extra handling needed
          break;
      }
    });
    
    document.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = false;
      
      if (e.key === 'Control') {
        this.ctrlHeld = false;
        // Re-lock pointer when Ctrl is released (if still in FPS mode)
        if (this.isFPSMode && !this.pointerLocked) {
          canvas.requestPointerLock();
        }
      }
    });
  }

  toggleCameraMode() {
    this.isFPSMode = !this.isFPSMode;
    const canvas = this.sceneManager.canvas;
    
    if (this.isFPSMode) {
      // Re-enable player control, lock pointer
      this.ant.isPlayerControlled = true;
      canvas.requestPointerLock();
    } else {
      // Release pointer for overhead strategy view
      if (this.pointerLocked) document.exitPointerLock();
      // Center overhead camera on hero ant's current position
      const worldX = (this.ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
      const worldZ = (this.ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
      this.overheadX = worldX;
      this.overheadZ = worldZ;
    }
    
    console.log(this.isFPSMode ? 'FPS Mode' : 'Overhead Mode');
  }

  _pickupFood() {
    const nearby = this.simulation.world.foodPatches.find(
      food => Math.hypot(this.ant.x - food.x, this.ant.y - food.y) < 1.5
    );
    
    if (nearby && nearby.amount > 0) {
      const foodTaken = Math.min(CONFIG.FOOD_CARRY_CAPACITY, nearby.amount);
      nearby.amount -= foodTaken;
      this.ant.carryingFood = foodTaken;
      this.ant.state = 'CARRYING';
      console.log('Picked up food!');
    }
  }

  _depositFood() {
    const nestDist = Math.hypot(this.ant.x - this.colony.nestX, this.ant.y - this.colony.nestY);
    if (nestDist < CONFIG.NEST_RADIUS && this.ant.carryingFood > 0) {
      this.colony.foodAmount += this.ant.carryingFood;
      this.ant.carryingFood = 0;
      this.ant.state = 'WANDERING';
      console.log('Deposited food at nest!');
    }
  }

  _rallyPheromone() {
    if (this.rallyCooldown > 0) return;
    
    this.simulation.world.depositPheromone(
      this.ant.x,
      this.ant.y,
      0,
      CONFIG.PLAYER_PHEROMONE_RALLY_STRENGTH
    );
    
    this.rallyCooldown = CONFIG.PLAYER_RALLY_COOLDOWN;
    console.log('Rally pheromone deployed!');
  }

  _bite() {
    if (this.biteCooldown > 0) return;
    
    // Find nearest enemy in the direction the player is facing
    let target = null;
    let minDist = CONFIG.BITE_RANGE;
    
    for (const enemy of this.simulation.enemyColony.ants) {
      if (enemy.isDead) continue;
      const dist = Math.hypot(this.ant.x - enemy.x, this.ant.y - enemy.y);
      if (dist < minDist) {
        minDist = dist;
        target = enemy;
      }
    }
    
    if (target) {
      target.health -= CONFIG.PLAYER_BITE_DAMAGE;
      this.biteCooldown = CONFIG.BITE_COOLDOWN;
      console.log(`Bit enemy! Damage: ${CONFIG.PLAYER_BITE_DAMAGE}`);
    }
  }

  _openBuildMenu() {
    console.log('Build menu opened (not yet implemented)');
  }

  /**
   * Update player ant behavior based on input.
   */
  update() {
    // Decrement cooldowns
    if (this.biteCooldown > 0) this.biteCooldown--;
    if (this.rallyCooldown > 0) this.rallyCooldown--;
    
    if (this.isFPSMode) {
      this._updateFPSMovement();
    } else {
      this._updateOverheadMovement();
    }
  }

  /**
   * FPS movement: ant body always faces camera yaw direction.
   * W/S = forward/backward in look direction.
   * A/D = turn yaw + partial lateral strafe (horse-like side-step).
   * Mouse = primary look control (no strafe from mouse).
   */
  _updateFPSMovement() {
    // Camera forward direction in grid coords
    // Three.js camera default faces -Z; rotation.y = yaw rotates it.
    // Camera forward in world = (-sin(yaw), 0, -cos(yaw))
    // World X = grid X, World Z = grid Y
    const fwdGridX = -Math.sin(this.yaw);
    const fwdGridY = -Math.cos(this.yaw);
    
    // Camera right in grid coords
    const rightGridX = Math.cos(this.yaw);
    const rightGridY = -Math.sin(this.yaw);
    
    // A/D keys: turn the camera yaw (primary function) + small side-step
    if (this.keys['a']) {
      this.yaw += this.turnRate; // Turn left
    }
    if (this.keys['d']) {
      this.yaw -= this.turnRate; // Turn right
    }
    
    // Build movement from W/S (full speed) and A/D (partial strafe)
    let gridDX = 0;
    let gridDY = 0;
    
    if (this.keys['w']) {
      gridDX += fwdGridX * CONFIG.ANT_SPEED;
      gridDY += fwdGridY * CONFIG.ANT_SPEED;
    }
    if (this.keys['s']) {
      // Backward at 60% speed (ants don't back up fast)
      gridDX -= fwdGridX * CONFIG.ANT_SPEED * 0.6;
      gridDY -= fwdGridY * CONFIG.ANT_SPEED * 0.6;
    }
    if (this.keys['a']) {
      // Partial left strafe (horse-like side-step)
      gridDX -= rightGridX * CONFIG.ANT_SPEED * this.strafeFraction;
      gridDY -= rightGridY * CONFIG.ANT_SPEED * this.strafeFraction;
    }
    if (this.keys['d']) {
      // Partial right strafe
      gridDX += rightGridX * CONFIG.ANT_SPEED * this.strafeFraction;
      gridDY += rightGridY * CONFIG.ANT_SPEED * this.strafeFraction;
    }
    
    // Apply movement
    if (gridDX !== 0 || gridDY !== 0) {
      this.ant.x += gridDX;
      this.ant.y += gridDY;
      
      // Clamp to world bounds
      this.ant.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH - 1, this.ant.x));
      this.ant.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT - 1, this.ant.y));
      
      // Deposit pheromone trail when carrying food
      if (this.ant.carryingFood) {
        this.simulation.world.depositPheromone(
          this.ant.x, this.ant.y, 0,
          CONFIG.PHEROMONE_STRENGTH_HOME * 0.7
        );
      }
    }
    
    // Always sync ant facing to camera yaw (body faces where we look)
    this.ant.angle = Math.atan2(fwdGridY, fwdGridX);
  }

  /**
   * Overhead mode: WASD pans the camera. Arrow keys control sim speed.
   * This is the "Ant Simulator" view — a proper top-down 2D strategy view.
   */
  _updateOverheadMovement() {
    const panSpeed = 2.0; // faster pan for bigger world
    if (this.keys['w']) this.overheadZ -= panSpeed;
    if (this.keys['s']) this.overheadZ += panSpeed;
    if (this.keys['a']) this.overheadX -= panSpeed;
    if (this.keys['d']) this.overheadX += panSpeed;
    
    // Clamp overhead pan to world bounds
    const halfWorld = CONFIG.WORLD_SIZE_3D / 2;
    this.overheadX = Math.max(-halfWorld, Math.min(halfWorld, this.overheadX));
    this.overheadZ = Math.max(-halfWorld, Math.min(halfWorld, this.overheadZ));
  }

  /**
   * Update camera position/orientation.
   */
  updateCamera(camera) {
    if (this.isFPSMode) {
      // Convert ant grid position → 3D world position
      const worldX = (this.ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
      const worldZ = (this.ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
      
      // Camera at ant head level, on terrain surface
      const terrainY = this.sceneManager.getTerrainHeight(worldX, worldZ);
      camera.position.set(worldX, terrainY + 0.5, worldZ);
      
      // Build look direction from yaw & pitch using Euler
      camera.rotation.order = 'YXZ';
      camera.rotation.set(this.pitch, this.yaw, 0);
      
      // Update FOV for ant-level perspective
      if (camera.fov !== CONFIG.PLAYER_FOV) {
        camera.fov = CONFIG.PLAYER_FOV;
        camera.updateProjectionMatrix();
      }
    } else {
      // Overhead strategic view — "Ant Simulator" top-down
      // Camera looks straight down, high enough to see a good chunk of the world
      camera.position.set(this.overheadX, 45, this.overheadZ + 15);
      camera.rotation.order = 'YXZ';
      // Slight angle (not fully 90°) so you can see the 3D-ness of ants and nests
      camera.rotation.set(-Math.PI / 2.3, 0, 0);
      
      // Wider FOV for overhead
      if (camera.fov !== 60) {
        camera.fov = 60;
        camera.updateProjectionMatrix();
      }
    }
  }
}

export default PlayerController;
