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
    colony.ants.push(this.ant);
    simulation.setPlayerAnt(this.ant);
    
    // Input state
    this.keys = {};
    this.mouseDown = false;
    
    // FPS camera angles (radians)
    this.yaw = 0;          // Horizontal rotation (left/right)
    this.pitch = 0;         // Vertical rotation (up/down), clamped
    this.mouseSensitivity = 0.002;
    
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
      canvas.requestPointerLock();
    } else {
      if (this.pointerLocked) document.exitPointerLock();
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
   * FPS movement: WASD moves relative to where the camera (yaw) is facing.
   * Forward (W) = direction of camera yaw on the XZ ground plane.
   */
  _updateFPSMovement() {
    // Build local movement vector from WASD
    let moveX = 0; // strafe (left/right)
    let moveZ = 0; // forward/back
    
    if (this.keys['w']) moveZ += 1;
    if (this.keys['s']) moveZ -= 1;
    if (this.keys['a']) moveX -= 1;
    if (this.keys['d']) moveX += 1;
    
    if (moveX !== 0 || moveZ !== 0) {
      // Normalize diagonal movement
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= len;
      moveZ /= len;
      
      // Rotate movement by camera yaw to get world-relative direction
      // yaw=0 means looking along +Z in 3D, which maps to grid direction
      // Forward vector from yaw: (sin(yaw), cos(yaw)) in grid XY
      const sinYaw = Math.sin(this.yaw);
      const cosYaw = Math.cos(this.yaw);
      
      // forward direction in grid coords
      const fwdGridX = sinYaw;
      const fwdGridY = -cosYaw;
      
      // right direction in grid coords (perpendicular)
      const rightGridX = cosYaw;
      const rightGridY = sinYaw;
      
      // Combine forward + strafe
      const gridDX = (fwdGridX * moveZ + rightGridX * moveX) * CONFIG.ANT_SPEED;
      const gridDY = (fwdGridY * moveZ + rightGridY * moveX) * CONFIG.ANT_SPEED;
      
      this.ant.x += gridDX;
      this.ant.y += gridDY;
      
      // Update ant facing angle to match movement direction
      this.ant.angle = Math.atan2(gridDY, gridDX);
      
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
  }

  /**
   * Overhead mode: WASD pans the camera, ant is AI-controlled.
   */
  _updateOverheadMovement() {
    const panSpeed = 0.5;
    if (this.keys['w']) this.overheadZ -= panSpeed;
    if (this.keys['s']) this.overheadZ += panSpeed;
    if (this.keys['a']) this.overheadX -= panSpeed;
    if (this.keys['d']) this.overheadX += panSpeed;
  }

  /**
   * Update camera position/orientation.
   */
  updateCamera(camera) {
    if (this.isFPSMode) {
      // Convert ant grid position → 3D world position
      const worldX = (this.ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
      const worldZ = (this.ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
      
      // Camera at ant head level
      camera.position.set(worldX, 0.5, worldZ);
      
      // Build look direction from yaw & pitch using Euler
      // Reset rotation and apply yaw (Y axis) then pitch (X axis)
      camera.rotation.order = 'YXZ';
      camera.rotation.set(this.pitch, this.yaw, 0);
    } else {
      // Overhead strategic view
      camera.position.set(this.overheadX, 40, this.overheadZ);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(-Math.PI / 2, 0, 0);
    }
  }
}

export default PlayerController;
